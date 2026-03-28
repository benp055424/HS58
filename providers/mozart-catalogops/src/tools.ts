import type { ProfileAuditInput, ModelCoverageInput, LaunchReadinessInput, ToolHandler } from './types.js';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MARKETPLACE_URL = 'https://handshake58.com';

function parseInput<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function marketplaceUrlFrom(inputUrl?: string): string {
  return (inputUrl || process.env.MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL).replace(/\/$/, '');
}

async function fetchJson(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProviders(payload: any): any[] {
  if (Array.isArray(payload?.providers)) return payload.providers;
  if (Array.isArray(payload)) return payload;
  return [];
}

function extractModelId(model: any): string {
  return String(model?.modelId || model?.id || model?.name || '').trim();
}

function modelPrice(model: any): number {
  const p = model?.pricing?.inputPer1kTokens ?? model?.inputPer1kTokens ?? 0;
  return toNumber(p, 0);
}

function providerLatencyMs(provider: any): number {
  return toNumber(provider?.status?.latencyMs ?? provider?.avgResponseTime, 99999);
}

function providerOnline(provider: any): boolean {
  const statusOnline = provider?.status?.online;
  if (typeof statusOnline === 'boolean') return statusOnline;
  if (typeof provider?.isOnline === 'boolean') return provider.isOnline;
  return true;
}

function compactProvider(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    tier: provider.tier || 'unknown',
    category: provider.category || 'unknown',
    protocol: provider.protocol || 'unknown',
    score: toNumber(provider.score, 0),
    qualityScore: toNumber(provider.qualityScore, 0),
    latencyMs: providerLatencyMs(provider),
    online: providerOnline(provider),
    apiUrl: provider.apiUrl || null,
  };
}

function selectCandidates(
  providers: any[],
  modelHint: string | undefined,
  category: string | undefined,
  protocol: string | undefined
): any[] {
  const hint = (modelHint || '').toLowerCase();
  const cat = (category || '').toLowerCase();
  const proto = (protocol || '').toLowerCase();

  return providers.filter((provider) => {
    if (!providerOnline(provider)) return false;
    if (cat && String(provider.category || '').toLowerCase() !== cat) return false;
    if (proto && proto !== 'all' && String(provider.protocol || '').toLowerCase() !== proto) return false;

    if (!hint) return true;
    const models = Array.isArray(provider.models) ? provider.models : [];
    if (models.length === 0) {
      return String(provider.name || '').toLowerCase().includes(hint);
    }

    return models.some((model: any) => {
      const id = extractModelId(model).toLowerCase();
      return id.includes(hint) || String(model?.name || '').toLowerCase().includes(hint);
    });
  });
}

function unitCost(provider: any, modelHint?: string): number {
  const models = Array.isArray(provider.models) ? provider.models : [];
  const hint = (modelHint || '').toLowerCase();

  if (models.length === 0) {
    return 0.01;
  }

  const priced = models
    .map((m: any) => ({ id: extractModelId(m), price: modelPrice(m) }))
    .filter((x: any) => x.id && Number.isFinite(x.price));

  if (priced.length === 0) return 0.01;

  if (hint) {
    const hinted = priced.filter((x: any) => x.id.toLowerCase().includes(hint));
    if (hinted.length > 0) {
      return Math.min(...hinted.map((x: any) => x.price));
    }
  }

  return Math.min(...priced.map((x: any) => x.price));
}

function completenessScore(provider: any): number {
  let score = 0;
  if (provider.description && String(provider.description).trim().length >= 20) score += 0.25;
  if (provider.docsUrl && String(provider.docsUrl).trim().length > 0) score += 0.25;
  if (provider.apiUrl && String(provider.apiUrl).trim().length > 0) score += 0.25;
  if (Array.isArray(provider.models) && provider.models.length > 0) score += 0.25;
  return Math.min(1, score);
}

const profileAudit: ToolHandler = async (raw) => {
  const input = parseInput<ProfileAuditInput>(raw);
  if (!input.providerName || !input.providerName.trim()) {
    return JSON.stringify({ error: 'providerName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const providerName = input.providerName.trim().toLowerCase();
  const minCompleteness = Math.max(0, Math.min(1, toNumber(input.minCompleteness, 0)));
  const maxProviders = Math.max(1, Math.min(20, toNumber(input.maxProviders, 5)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data);
  const candidates = providers
    .filter((p: any) => String(p.name || '').toLowerCase().includes(providerName))
    .map((provider: any) => ({
      provider,
      completeness: completenessScore(provider),
      estimatedUnitCostUsd: unitCost(provider),
    }))
    .filter((x: any) => x.completeness >= minCompleteness)
    .sort((a: any, b: any) =>
      b.completeness - a.completeness ||
      toNumber(b.provider.qualityScore, 0) - toNumber(a.provider.qualityScore, 0)
    )
    .slice(0, maxProviders);

  const ranked = candidates.map((x: any) => ({
    provider: compactProvider(x.provider),
    completeness: Number(x.completeness.toFixed(4)),
    estimatedUnitCostUsd: Number(x.estimatedUnitCostUsd.toFixed(6)),
    blockers: {
      missingDescription: !(x.provider.description && String(x.provider.description).trim().length >= 20),
      missingDocsUrl: !(x.provider.docsUrl && String(x.provider.docsUrl).trim().length > 0),
      missingApiUrl: !(x.provider.apiUrl && String(x.provider.apiUrl).trim().length > 0),
      missingModels: !(Array.isArray(x.provider.models) && x.provider.models.length > 0),
    },
  }));

  return JSON.stringify({
    marketplaceUrl,
    providerName: input.providerName,
    matchedProviders: ranked.length,
    candidates: ranked.length,
    results: ranked,
    generatedAt: new Date().toISOString(),
  });
};

const modelCoverage: ToolHandler = async (raw) => {
  const input = parseInput<ModelCoverageInput>(raw);
  if (!input.category || !input.category.trim()) {
    return JSON.stringify({ error: 'category is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = input.category.trim().toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const limit = Math.max(1, Math.min(50, toNumber(input.limit, 20)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const filtered = providers
    .filter((p: any) => String(p.category || '').toLowerCase() === category)
    .filter((p: any) => protocol === 'all' || String(p.protocol || '').toLowerCase() === protocol)
    .map((provider: any) => ({
      provider,
      unitCostUsd: unitCost(provider),
      modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
      reliability: toNumber(provider.qualityScore, 0),
    }))
    .sort((a: any, b: any) =>
      b.modelCount - a.modelCount || b.reliability - a.reliability
    )
    .slice(0, limit);

  const totalModels = filtered.reduce((acc: number, x: any) => acc + x.modelCount, 0);
  const avgModelsPerProvider = filtered.length ? totalModels / filtered.length : 0;

  return JSON.stringify({
    marketplaceUrl,
    category,
    protocol,
    providerCount: filtered.length,
    totalModels,
    avgModelsPerProvider: Number(avgModelsPerProvider.toFixed(2)),
    topProviders: filtered.map((x: any) => ({
      provider: compactProvider(x.provider),
      reliability: Number(x.reliability.toFixed(4)),
      modelCount: x.modelCount,
      estimatedUnitCostUsd: Number(x.unitCostUsd.toFixed(6)),
    })),
    generatedAt: new Date().toISOString(),
  });
};

const launchReadiness: ToolHandler = async (raw) => {
  const input = parseInput<LaunchReadinessInput>(raw);
  if (!input.candidateName || !input.candidateName.trim()) {
    return JSON.stringify({ error: 'candidateName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const targetProtocol = (input.targetProtocol || 'drain').toLowerCase();
  const category = (input.category || '').toLowerCase();

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const sameCategory = category
    ? providers.filter((p: any) => String(p.category || '').toLowerCase() === category)
    : providers;
  const sameProtocol = sameCategory.filter((p: any) => String(p.protocol || '').toLowerCase() === targetProtocol);

  const benchmarks = sameProtocol
    .map((provider: any) => ({
      provider,
      completeness: completenessScore(provider),
      quality: toNumber(provider.qualityScore, 0),
      score: toNumber(provider.score, 0),
      modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
    }))
    .sort((a: any, b: any) => b.completeness - a.completeness || b.quality - a.quality);

  const avgCompleteness = benchmarks.length
    ? benchmarks.reduce((acc: number, x: any) => acc + x.completeness, 0) / benchmarks.length
    : 0;
  const avgModelCount = benchmarks.length
    ? benchmarks.reduce((acc: number, x: any) => acc + x.modelCount, 0) / benchmarks.length
    : 0;

  const readinessScore = Math.min(1, (avgCompleteness * 0.45) + (Math.min(1, avgModelCount / 5) * 0.35) + 0.2);

  return JSON.stringify({
    marketplaceUrl,
    candidateName: input.candidateName,
    targetProtocol,
    category: category || null,
    benchmarkSetSize: benchmarks.length,
    readinessScore: Number(readinessScore.toFixed(4)),
    checklist: {
      recommendedModelCount: Math.max(3, Math.ceil(avgModelCount)),
      profileCompletenessTarget: Number(Math.max(0.8, avgCompleteness).toFixed(2)),
      docsLengthMinimumChars: 100,
      supportsStreamingSuggested: true,
    },
    topBenchmarks: benchmarks.slice(0, 5).map((x: any) => ({
      provider: compactProvider(x.provider),
      completeness: Number(x.completeness.toFixed(4)),
      quality: Number(x.quality.toFixed(4)),
      score: Number(x.score.toFixed(4)),
      modelCount: x.modelCount,
    })),
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['catalogops/profile-audit', profileAudit],
  ['catalogops/model-coverage', modelCoverage],
  ['catalogops/launch-readiness', launchReadiness],
]);
