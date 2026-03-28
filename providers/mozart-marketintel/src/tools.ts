import type { MarketSectorInput, ProviderGapInput, RouteOpportunityInput, ToolHandler } from './types.js';

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

const marketSectorMap: Record<string, string[]> = {
  llm: ['llm', 'openai', 'anthropic', 'claude', 'gpt', 'chat'],
  data: ['data', 'taostats', 'metrics', 'subnet', 'metagraph', 'validator'],
  scraping: ['scraping', 'crawl', 'search', 'desearch', 'web'],
  code: ['code', 'e2b', 'sandbox', 'execute'],
  multimodal: ['multi-modal', 'image', 'audio', 'video'],
};

function scoreSectorFit(provider: any, sector: string): number {
  const keys = marketSectorMap[sector] || [];
  const category = String(provider.category || '').toLowerCase();
  const name = String(provider.name || '').toLowerCase();
  const models = Array.isArray(provider.models) ? provider.models : [];
  let fit = 0;
  if (keys.some((k) => category.includes(k))) fit += 0.5;
  if (keys.some((k) => name.includes(k))) fit += 0.2;
  if (models.some((m: any) => {
    const id = extractModelId(m).toLowerCase();
    return keys.some((k) => id.includes(k));
  })) fit += 0.3;
  return Math.min(1, fit);
}

const sectorPulse: ToolHandler = async (raw) => {
  const input = parseInput<MarketSectorInput>(raw);
  if (!input.sector || !input.sector.trim()) {
    return JSON.stringify({ error: 'sector is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const sector = input.sector.trim().toLowerCase();
  const maxProviders = Math.max(1, Math.min(20, toNumber(input.maxProviders, 5)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const candidates = selectCandidates(providers, input.modelHint, input.category, input.protocol)
    .map((provider: any) => ({
      provider,
      sectorFit: scoreSectorFit(provider, sector),
      estimatedUnitCostUsd: unitCost(provider, input.modelHint),
    }))
    .filter((x: any) => x.sectorFit > 0)
    .sort((a: any, b: any) =>
      b.sectorFit - a.sectorFit ||
      toNumber(b.provider.qualityScore, 0) - toNumber(a.provider.qualityScore, 0) ||
      providerLatencyMs(a.provider) - providerLatencyMs(b.provider)
    )
    .slice(0, maxProviders);

  const ranked = candidates.map((x: any) => ({
    provider: compactProvider(x.provider),
    sectorFit: Number(x.sectorFit.toFixed(4)),
    estimatedUnitCostUsd: Number(x.estimatedUnitCostUsd.toFixed(6)),
    signalSummary: {
      qualityScore: toNumber(x.provider.qualityScore, 0),
      marketplaceScore: toNumber(x.provider.score, 0),
      latencyMs: providerLatencyMs(x.provider),
    },
  }));

  return JSON.stringify({
    marketplaceUrl,
    sector,
    matchedProviders: ranked.length,
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

const providerGap: ToolHandler = async (raw) => {
  const input = parseInput<ProviderGapInput>(raw);
  if (!input.sector || !input.sector.trim()) {
    return JSON.stringify({ error: 'sector is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const sector = input.sector.trim().toLowerCase();
  const targetCount = Math.max(1, Math.min(20, toNumber(input.targetCount, 8)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const filtered = selectCandidates(providers, input.modelHint, input.category, input.protocol)
    .map((provider: any) => ({
      provider,
      sectorFit: scoreSectorFit(provider, sector),
      unitCostUsd: unitCost(provider, input.modelHint),
      reliability: toNumber(provider.qualityScore, 0) * 0.7 + toNumber(provider.score, 0) * 0.3,
    }))
    .filter((x: any) => x.sectorFit > 0)
    .sort((a: any, b: any) =>
      b.reliability - a.reliability ||
      a.unitCostUsd - b.unitCostUsd
    )
    .slice(0, targetCount);

  const currentCount = filtered.length;
  const recommendedAdds = Math.max(0, toNumber(input.targetCount, 8) - currentCount);
  const topMissingSignals: string[] = [];
  if (!filtered.some((x: any) => x.provider.protocol === 'drain')) topMissingSignals.push('drain_protocol_coverage');
  if (!filtered.some((x: any) => providerLatencyMs(x.provider) < 800)) topMissingSignals.push('low_latency_provider');
  if (!filtered.some((x: any) => toNumber(x.provider.qualityScore, 0) >= 0.5)) topMissingSignals.push('high_quality_score_provider');

  return JSON.stringify({
    marketplaceUrl,
    sector,
    targetCount,
    currentCount,
    recommendedAdds,
    topCandidates: filtered.map((x: any) => ({
      provider: compactProvider(x.provider),
      sectorFit: Number(x.sectorFit.toFixed(4)),
      reliability: Number(x.reliability.toFixed(4)),
      estimatedUnitCostUsd: Number(x.unitCostUsd.toFixed(6)),
    })),
    missingSignals: topMissingSignals,
    generatedAt: new Date().toISOString(),
  });
};

const routeOpportunity: ToolHandler = async (raw) => {
  const input = parseInput<RouteOpportunityInput>(raw);
  if (!input.modelHint || !input.modelHint.trim()) {
    return JSON.stringify({ error: 'modelHint is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const maxAlternatives = Math.max(1, Math.min(6, toNumber(input.maxAlternatives, 3)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).filter(providerOnline);
  const candidates = selectCandidates(providers, input.modelHint, input.category, input.protocol);
  const ranked = candidates
    .map((provider: any) => ({
      provider,
      unitCostUsd: unitCost(provider, input.modelHint),
      reliabilityScore: toNumber(provider.qualityScore, 0) * 0.7 + toNumber(provider.score, 0) * 0.3,
      latencyMs: providerLatencyMs(provider),
    }))
    .sort((a: any, b: any) =>
      b.reliabilityScore - a.reliabilityScore ||
      a.unitCostUsd - b.unitCostUsd ||
      a.latencyMs - b.latencyMs
    );

  if (ranked.length === 0) {
    return JSON.stringify({
      marketplaceUrl,
      modelHint: input.modelHint,
      error: 'No matching online providers found for modelHint/category/protocol',
    });
  }

  const winner = ranked[0];
  const alternatives = ranked.slice(1, 1 + maxAlternatives);
  const avgAltCost = alternatives.length > 0
    ? alternatives.reduce((acc: number, x: any) => acc + x.unitCostUsd, 0) / alternatives.length
    : winner.unitCostUsd;
  const impliedEdge = avgAltCost > 0 ? ((avgAltCost - winner.unitCostUsd) / avgAltCost) : 0;

  return JSON.stringify({
    marketplaceUrl,
    modelHint: input.modelHint,
    opportunity: {
      winner: {
        provider: compactProvider(winner.provider),
        estimatedUnitCostUsd: Number(winner.unitCostUsd.toFixed(6)),
        reliabilityScore: Number(winner.reliabilityScore.toFixed(4)),
        latencyMs: winner.latencyMs,
      },
      alternatives: alternatives.map((row: any, idx: number) => ({
        rank: idx + 2,
        provider: compactProvider(row.provider),
        estimatedUnitCostUsd: Number(row.unitCostUsd.toFixed(6)),
        reliabilityScore: Number(row.reliabilityScore.toFixed(4)),
        latencyMs: row.latencyMs,
      })),
      impliedCostEdge: Number(impliedEdge.toFixed(4)),
    },
    executionGuardrails: {
      timeoutMs: Math.max(5000, Math.min(30000, toNumber(input.timeoutMs, 12000))),
      maxRetries: Math.max(1, Math.min(5, toNumber(input.maxRetries, 2))),
      cooldownSeconds: Math.max(30, Math.min(600, toNumber(input.cooldownSeconds, 120))),
    },
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['marketintel/sector-pulse', sectorPulse],
  ['marketintel/provider-gap', providerGap],
  ['marketintel/route-opportunity', routeOpportunity],
]);
