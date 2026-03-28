import type { ListingScoreInput, TrustCheckInput, ReleaseGateInput, ToolHandler } from './types.js';

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

function providerOnline(provider: any): boolean {
  const statusOnline = provider?.status?.online;
  if (typeof statusOnline === 'boolean') return statusOnline;
  if (typeof provider?.isOnline === 'boolean') return provider.isOnline;
  return true;
}

function providerLatencyMs(provider: any): number {
  return toNumber(provider?.status?.latencyMs ?? provider?.avgResponseTime, 12000);
}

function providerQuality(provider: any): number {
  return toNumber(provider?.qualityScore ?? provider?.score, 0);
}

function providerScore(provider: any): number {
  return toNumber(provider?.score ?? provider?.qualityScore, 0);
}

function unitCost(provider: any, modelHint?: string): number {
  const models = Array.isArray(provider.models) ? provider.models : [];
  const hint = (modelHint || '').toLowerCase();

  const priced = models
    .map((m: any) => {
      const id = extractModelId(m);
      const raw = m?.pricing?.inputPer1kTokens ?? m?.inputPer1kTokens ?? 0;
      return { id, price: toNumber(raw, 0) };
    })
    .filter((x: any) => x.id && Number.isFinite(x.price));

  if (priced.length === 0) return 0.01;

  if (hint) {
    const hinted = priced.filter((x: any) => x.id.toLowerCase().includes(hint));
    if (hinted.length > 0) return Math.min(...hinted.map((x: any) => x.price));
  }

  return Math.min(...priced.map((x: any) => x.price));
}

function compactProvider(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    category: provider.category || 'unknown',
    protocol: provider.protocol || 'unknown',
    tier: provider.tier || 'unknown',
    online: providerOnline(provider),
    score: Number(providerScore(provider).toFixed(4)),
    qualityScore: Number(providerQuality(provider).toFixed(4)),
    latencyMs: providerLatencyMs(provider),
    modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
    apiUrl: provider.apiUrl || null,
  };
}

function qualityComponents(provider: any, modelHint?: string) {
  const descriptionScore = provider?.description && String(provider.description).trim().length >= 24 ? 1 : 0;
  const docsScore = provider?.docsUrl && String(provider.docsUrl).trim().length > 0 ? 1 : 0;
  const apiScore = provider?.apiUrl && String(provider.apiUrl).trim().length > 0 ? 1 : 0;
  const models = Array.isArray(provider.models) ? provider.models : [];
  const modelDepth = Math.min(1, models.length / 8);
  const latencyNorm = Math.max(0, 1 - (providerLatencyMs(provider) / 8000));
  const qualityNorm = Math.min(1, providerQuality(provider) / 100);

  const qualityScore = (descriptionScore * 0.15)
    + (docsScore * 0.15)
    + (apiScore * 0.15)
    + (modelDepth * 0.2)
    + (latencyNorm * 0.15)
    + (qualityNorm * 0.2);

  return {
    qualityScore,
    modelCount: models.length,
    estimatedUnitCostUsd: unitCost(provider, modelHint),
    blockers: {
      missingDescription: descriptionScore === 0,
      missingDocsUrl: docsScore === 0,
      missingApiUrl: apiScore === 0,
      weakModelDepth: modelDepth < 0.35,
      highLatency: latencyNorm < 0.4,
    },
  };
}

const listingScore: ToolHandler = async (raw) => {
  const input = parseInput<ListingScoreInput>(raw);
  if (!input.providerName || !input.providerName.trim()) {
    return JSON.stringify({ error: 'providerName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const providerName = input.providerName.trim().toLowerCase();
  const minScore = Math.max(0, Math.min(1, toNumber(input.minScore, 0)));
  const maxProviders = Math.max(1, Math.min(25, toNumber(input.maxProviders, 8)));
  const modelHint = input.modelHint?.trim();

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data).filter(providerOnline);

  const scored = providers
    .filter((p: any) => String(p.name || '').toLowerCase().includes(providerName))
    .map((provider: any) => {
      const components = qualityComponents(provider, modelHint);
      return { provider, ...components };
    })
    .filter((x: any) => x.qualityScore >= minScore)
    .sort((a: any, b: any) => b.qualityScore - a.qualityScore || providerQuality(b.provider) - providerQuality(a.provider))
    .slice(0, maxProviders);

  return JSON.stringify({
    marketplaceUrl,
    providerName: input.providerName,
    matchedProviders: scored.length,
    results: scored.map((x: any) => ({
      provider: compactProvider(x.provider),
      listingScore: Number(x.qualityScore.toFixed(4)),
      estimatedUnitCostUsd: Number(x.estimatedUnitCostUsd.toFixed(6)),
      blockers: x.blockers,
    })),
    generatedAt: new Date().toISOString(),
  });
};

const trustCheck: ToolHandler = async (raw) => {
  const input = parseInput<TrustCheckInput>(raw);
  if (!input.providerName || !input.providerName.trim()) {
    return JSON.stringify({ error: 'providerName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const providerName = input.providerName.trim().toLowerCase();
  const maxMatches = Math.max(1, Math.min(20, toNumber(input.maxMatches, 5)));
  const minQualityScore = Math.max(0, toNumber(input.minQualityScore, 0));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data);

  const checks = providers
    .filter((p: any) => String(p.name || '').toLowerCase().includes(providerName))
    .map((provider: any) => {
      const quality = providerQuality(provider);
      const latency = providerLatencyMs(provider);
      const models = Array.isArray(provider.models) ? provider.models : [];
      const hasDocs = Boolean(provider.docsUrl && String(provider.docsUrl).trim().length > 0);
      const hasApi = Boolean(provider.apiUrl && String(provider.apiUrl).trim().length > 0);
      const isOnline = providerOnline(provider);

      const riskFlags: string[] = [];
      if (!isOnline) riskFlags.push('offline');
      if (quality < minQualityScore) riskFlags.push('low_quality_signal');
      if (latency > 3500) riskFlags.push('high_latency_signal');
      if (!hasDocs) riskFlags.push('missing_docs');
      if (!hasApi) riskFlags.push('missing_api_url');
      if (models.length === 0) riskFlags.push('no_models_listed');

      const trustScore = Math.max(0, 1 - (riskFlags.length * 0.16));

      return {
        provider: compactProvider(provider),
        trustScore: Number(trustScore.toFixed(4)),
        riskFlags,
        confidence: Number((Math.min(1, (hasDocs ? 0.25 : 0) + (hasApi ? 0.25 : 0) + (models.length > 0 ? 0.25 : 0) + (isOnline ? 0.25 : 0))).toFixed(4)),
      };
    })
    .sort((a: any, b: any) => b.trustScore - a.trustScore)
    .slice(0, maxMatches);

  return JSON.stringify({
    marketplaceUrl,
    providerName: input.providerName,
    evaluated: checks.length,
    checks,
    generatedAt: new Date().toISOString(),
  });
};

const releaseGate: ToolHandler = async (raw) => {
  const input = parseInput<ReleaseGateInput>(raw);
  if (!input.candidateName || !input.candidateName.trim()) {
    return JSON.stringify({ error: 'candidateName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const targetProtocol = (input.targetProtocol || 'drain').toLowerCase();
  const minBenchmarkCount = Math.max(1, Math.min(30, toNumber(input.minBenchmarkCount, 5)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data).filter(providerOnline);

  const peers = providers
    .filter((p: any) => !category || String(p.category || '').toLowerCase() === category)
    .filter((p: any) => targetProtocol === 'all' || String(p.protocol || '').toLowerCase() === targetProtocol)
    .map((provider: any) => {
      const comps = qualityComponents(provider);
      return {
        provider,
        listingScore: comps.qualityScore,
        modelCount: comps.modelCount,
      };
    })
    .sort((a: any, b: any) => b.listingScore - a.listingScore);

  const benchmarkSet = peers.slice(0, Math.max(minBenchmarkCount, 10));
  const avgListingScore = benchmarkSet.length
    ? benchmarkSet.reduce((acc: number, x: any) => acc + x.listingScore, 0) / benchmarkSet.length
    : 0.65;
  const avgModelCount = benchmarkSet.length
    ? benchmarkSet.reduce((acc: number, x: any) => acc + x.modelCount, 0) / benchmarkSet.length
    : 4;

  const checklist = {
    recommendedMinModels: Math.max(3, Math.ceil(avgModelCount)),
    recommendedListingScore: Number(Math.max(0.7, avgListingScore).toFixed(3)),
    requireDocsUrl: true,
    requireApiUrl: true,
    requireStructuredModelIds: true,
  };

  const readinessScore = Math.min(1, (avgListingScore * 0.55) + (Math.min(1, avgModelCount / 6) * 0.25) + 0.2);
  const gateDecision = readinessScore >= 0.8 ? 'pass' : readinessScore >= 0.65 ? 'warn' : 'block';

  return JSON.stringify({
    marketplaceUrl,
    candidateName: input.candidateName,
    category: category || null,
    targetProtocol,
    benchmarkCount: benchmarkSet.length,
    readinessScore: Number(readinessScore.toFixed(4)),
    gateDecision,
    checklist,
    topBenchmarks: benchmarkSet.slice(0, 5).map((x: any) => ({
      provider: compactProvider(x.provider),
      listingScore: Number(x.listingScore.toFixed(4)),
      modelCount: x.modelCount,
    })),
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['qualityops/listing-score', listingScore],
  ['qualityops/trust-check', trustCheck],
  ['qualityops/release-gate', releaseGate],
]);
