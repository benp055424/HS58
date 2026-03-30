import type {
  SubnetOverviewInput,
  ValidatorMinerRankInput,
  EmissionRotationInput,
  ToolHandler,
} from './types.js';

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

const subnetOverview: ToolHandler = async (raw) => {
  const input = parseInput<SubnetOverviewInput>(raw);

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = input.category?.trim();
  const protocol = input.protocol?.trim();
  const modelHint = input.modelHint?.trim();
  const maxProviders = Math.max(1, Math.min(25, toNumber(input.maxProviders, 10)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const candidates = selectCandidates(providers, modelHint, category, protocol);

  const byCategory = candidates.reduce((acc: Record<string, number>, p: any) => {
    const key = String(p.category || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const byProtocol = candidates.reduce((acc: Record<string, number>, p: any) => {
    const key = String(p.protocol || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const top = candidates
    .map((provider: any) => ({
      provider: compactProvider(provider),
      unitCostUsd: Number(unitCost(provider, modelHint).toFixed(6)),
      modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
    }))
    .sort((a: any, b: any) => b.provider.qualityScore - a.provider.qualityScore || a.provider.latencyMs - b.provider.latencyMs)
    .slice(0, maxProviders);

  return JSON.stringify({
    marketplaceUrl,
    filters: {
      category: category || null,
      protocol: protocol || null,
      modelHint: modelHint || null,
    },
    totalOnlineProviders: providers.length,
    matchedProviders: candidates.length,
    byCategory,
    byProtocol,
    topProviders: top,
    generatedAt: new Date().toISOString(),
  });
};

const validatorMinerRank: ToolHandler = async (raw) => {
  const input = parseInput<ValidatorMinerRankInput>(raw);
  if (!input.modelHint || !input.modelHint.trim()) {
    return JSON.stringify({ error: 'modelHint is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const quoteUsd = Math.max(0.001, toNumber(input.quoteUsd, 0.5));
  const maxProviders = Math.max(1, Math.min(20, toNumber(input.maxProviders, 6)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data);
  const candidates = selectCandidates(providers, input.modelHint, input.category, input.protocol);

  const ranked = candidates
    .map((provider: any) => {
      const perReq = unitCost(provider, input.modelHint);
      const estRequests = Math.max(1, Math.floor(quoteUsd / Math.max(0.000001, perReq)));
      return {
        provider: compactProvider(provider),
        modelHint: input.modelHint,
        estimatedCostUsd: Number((perReq * estRequests).toFixed(6)),
        estimatedUnitCostUsd: Number(perReq.toFixed(6)),
        estimatedRequests: estRequests,
      };
    })
    .sort((a: any, b: any) => a.estimatedUnitCostUsd - b.estimatedUnitCostUsd || a.provider.latencyMs - b.provider.latencyMs)
    .slice(0, maxProviders);

  return JSON.stringify({
    marketplaceUrl,
    quoteUsd,
    candidates: ranked.length,
    results: ranked,
    generatedAt: new Date().toISOString(),
  });
};

function scoreForBudget(provider: any, maxBudgetUsd: number, modelHint?: string): number {
  const perReq = unitCost(provider, modelHint);
  const affordability = Math.min(1, maxBudgetUsd / Math.max(perReq, 0.000001));
  const quality = Math.min(1, toNumber(provider.qualityScore, 0));
  const score = Math.min(1, toNumber(provider.score, 0));
  const latency = providerLatencyMs(provider);
  const latencyScore = latency >= 99999 ? 0 : Math.max(0, 1 - latency / 3000);

  return affordability * 0.4 + quality * 0.25 + score * 0.2 + latencyScore * 0.15;
}

const emissionRotation: ToolHandler = async (raw) => {
  const input = parseInput<EmissionRotationInput>(raw);
  if (!input.modelHint || !input.modelHint.trim()) {
    return JSON.stringify({ error: 'modelHint is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const maxBackups = Math.max(1, Math.min(6, toNumber(input.maxBackups, 3)));
  const maxBudgetUsd = Math.max(0.001, toNumber(input.maxBudgetUsd, 0.03));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data);
  const candidates = selectCandidates(providers, input.modelHint, input.category, input.protocol);
  const ranked = candidates
    .map((provider: any) => ({
      provider,
      fitScore: scoreForBudget(provider, maxBudgetUsd, input.modelHint) + (providerOnline(provider) ? 0.1 : -0.5),
      unitCostUsd: unitCost(provider, input.modelHint),
      reliabilityScore: toNumber(provider.qualityScore, 0) * 0.7 + toNumber(provider.score, 0) * 0.3,
    }))
    .sort((a: any, b: any) => b.reliabilityScore - a.reliabilityScore || a.unitCostUsd - b.unitCostUsd);

  if (ranked.length === 0) {
    return JSON.stringify({
      marketplaceUrl,
      modelHint: input.modelHint,
      error: 'No matching providers found for modelHint/category/protocol',
    });
  }

  const primary = ranked[0];
  const backups = ranked.slice(1, 1 + maxBackups);
  const projectedCost = primary.unitCostUsd + backups.reduce((acc: number, row: any) => acc + row.unitCostUsd * 0.25, 0);

  return JSON.stringify({
    marketplaceUrl,
    modelHint: input.modelHint,
    primary: {
      provider: compactProvider(primary.provider),
      reliabilityScore: Number(primary.reliabilityScore.toFixed(4)),
      estimatedUnitCostUsd: Number(primary.unitCostUsd.toFixed(6)),
    },
    backups: backups.map((row: any, idx: number) => ({
      priority: idx + 1,
      provider: compactProvider(row.provider),
      reliabilityScore: Number(row.reliabilityScore.toFixed(4)),
      estimatedUnitCostUsd: Number(row.unitCostUsd.toFixed(6)),
      activationRule: `Rotate after ${Math.max(1, toNumber(input.failureThreshold, 2))} consecutive failures`,
    })),
    policy: {
      failureThreshold: Math.max(1, Math.min(5, toNumber(input.failureThreshold, 2))),
      timeoutMs: Math.max(3000, Math.min(30000, toNumber(input.timeoutMs, 10000))),
      rotationWindowSeconds: Math.max(30, Math.min(600, toNumber(input.rotationWindowSeconds, 120))),
    },
    budget: {
      maxBudgetUsd: Number(maxBudgetUsd.toFixed(6)),
      projectedCostUsd: Number(projectedCost.toFixed(6)),
      withinBudget: projectedCost <= maxBudgetUsd,
    },
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  // Canonical model IDs exposed by /v1/models and /v1/pricing
  ['subnetpulse/subnet-brief', subnetOverview],
  ['subnetpulse/validator-route', validatorMinerRank],
  ['subnetpulse/miner-route', emissionRotation],
  // Backward-compatible aliases to avoid breaking older callers
  ['subnetpulse/subnet-overview', subnetOverview],
  ['subnetpulse/validator-miner-rank', validatorMinerRank],
  ['subnetpulse/emission-rotation', emissionRotation],
]);
