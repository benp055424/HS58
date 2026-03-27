import type { ProviderQuoteInput, BudgetRouteInput, FailoverPlanInput, ToolHandler } from './types.js';

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

const providerQuote: ToolHandler = async (raw) => {
  const input = parseInput<ProviderQuoteInput>(raw);
  if (!input.modelHint || !input.modelHint.trim()) {
    return JSON.stringify({ error: 'modelHint is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const quoteUsd = Math.max(0.001, toNumber(input.quoteUsd, 1));
  const maxProviders = Math.max(1, Math.min(20, toNumber(input.maxProviders, 5)));

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

const budgetRoute: ToolHandler = async (raw) => {
  const input = parseInput<BudgetRouteInput>(raw);
  if (!input.goal || !input.goal.trim()) {
    return JSON.stringify({ error: 'goal is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const maxBudgetUsd = Math.max(0.001, toNumber(input.maxBudgetUsd, 0.05));
  const maxHops = Math.max(1, Math.min(6, toNumber(input.maxHops, 3)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const filtered = selectCandidates(providers, input.modelHint, input.category, input.protocol);
  const pool = filtered.length > 0 ? filtered : providers;

  const ranked = pool
    .map((provider: any) => ({
      provider,
      fitScore: scoreForBudget(provider, maxBudgetUsd, input.modelHint),
      unitCostUsd: unitCost(provider, input.modelHint),
    }))
    .sort((a: any, b: any) => b.fitScore - a.fitScore)
    .slice(0, maxHops);

  let runningCost = 0;
  const route = ranked.map((row: any, idx: number) => {
    runningCost += row.unitCostUsd;
    return {
      step: idx + 1,
      role: idx === 0 ? 'primary' : 'secondary',
      provider: compactProvider(row.provider),
      estimatedStepCostUsd: Number(row.unitCostUsd.toFixed(6)),
      cumulativeCostUsd: Number(runningCost.toFixed(6)),
      fitScore: Number(row.fitScore.toFixed(4)),
    };
  });

  return JSON.stringify({
    goal: input.goal,
    marketplaceUrl,
    budget: {
      maxBudgetUsd: Number(maxBudgetUsd.toFixed(6)),
      estimatedRouteCostUsd: Number(runningCost.toFixed(6)),
      withinBudget: runningCost <= maxBudgetUsd,
    },
    route,
    generatedAt: new Date().toISOString(),
  });
};

const failoverPlan: ToolHandler = async (raw) => {
  const input = parseInput<FailoverPlanInput>(raw);
  if (!input.modelHint || !input.modelHint.trim()) {
    return JSON.stringify({ error: 'modelHint is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const maxBackups = Math.max(1, Math.min(5, toNumber(input.maxBackups, 2)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data);
  const candidates = selectCandidates(providers, input.modelHint, input.category, input.protocol);
  const ranked = candidates
    .map((provider: any) => ({
      provider,
      unitCostUsd: unitCost(provider, input.modelHint),
      reliabilityScore: toNumber(provider.qualityScore, 0) * 0.7 + toNumber(provider.score, 0) * 0.3,
      latencyMs: providerLatencyMs(provider),
    }))
    .sort((a: any, b: any) => b.reliabilityScore - a.reliabilityScore || a.latencyMs - b.latencyMs);

  if (ranked.length === 0) {
    return JSON.stringify({
      marketplaceUrl,
      modelHint: input.modelHint,
      error: 'No matching online providers found for the requested modelHint/category/protocol',
    });
  }

  const primary = ranked[0];
  const backups = ranked.slice(1, 1 + maxBackups);

  return JSON.stringify({
    marketplaceUrl,
    modelHint: input.modelHint,
    primary: {
      provider: compactProvider(primary.provider),
      estimatedUnitCostUsd: Number(primary.unitCostUsd.toFixed(6)),
      reliabilityScore: Number(primary.reliabilityScore.toFixed(4)),
      latencyMs: primary.latencyMs,
    },
    backups: backups.map((row: any, idx: number) => ({
      priority: idx + 1,
      provider: compactProvider(row.provider),
      estimatedUnitCostUsd: Number(row.unitCostUsd.toFixed(6)),
      reliabilityScore: Number(row.reliabilityScore.toFixed(4)),
      latencyMs: row.latencyMs,
      activationRule: `Use when previous provider returns >=2 failures or exceeds timeout`,
    })),
    recommendedPolicy: {
      timeoutMs: Math.max(5000, Math.min(30000, toNumber(input.timeoutMs, 12000))),
      maxRetriesPerProvider: Math.max(1, Math.min(5, toNumber(input.maxRetriesPerProvider, 2))),
      circuitBreakSeconds: Math.max(30, Math.min(600, toNumber(input.circuitBreakSeconds, 120))),
    },
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['opsguard/provider-quote', providerQuote],
  ['opsguard/budget-route', budgetRoute],
  ['opsguard/failover-plan', failoverPlan],
]);
