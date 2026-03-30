import type { OpportunityScanInput, RoiForecastInput, ExecutionPlaybookInput, ToolHandler } from './types.js';

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

function compact(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    category: provider.category || 'unknown',
    protocol: provider.protocol || 'unknown',
    tier: provider.tier || 'unknown',
    online: providerOnline(provider),
    latencyMs: providerLatencyMs(provider),
    qualityScore: Number(providerQuality(provider).toFixed(4)),
    modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
  };
}

const opportunityScan: ToolHandler = async (raw) => {
  const input = parseInput<OpportunityScanInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const strategy = (input.strategy || 'balanced').toLowerCase();
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const minExpectedMargin = Math.max(0.01, Math.min(0.95, toNumber(input.minExpectedMargin, 0.2)));
  const limit = Math.max(1, Math.min(30, toNumber(input.limit, 10)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .slice(0, limit);

  const opportunityRows = providers.map((provider: any) => {
    const modelCount = Array.isArray(provider.models) ? provider.models.length : 0;
    const online = providerOnline(provider);
    const quality = Math.min(1, providerQuality(provider) / 100);
    const latency = providerLatencyMs(provider);
    const latencyScore = latency >= 99999 ? 0 : Math.max(0, 1 - latency / 3000);
    const competitionPenalty = Math.min(0.5, modelCount / 80);
    const strategyWeight = strategy === 'aggressive'
      ? 1.15
      : strategy === 'conservative'
        ? 0.9
        : 1.0;

    const expectedMargin = Math.max(
      0.02,
      Number((0.18 + (0.22 * quality) + (0.18 * latencyScore) - competitionPenalty).toFixed(4))
    );
    const revenuePotential = Number((expectedMargin * (1 + modelCount / 20) * strategyWeight).toFixed(4));
    const confidence = Number(
      Math.min(1, Math.max(0.05, (online ? 0.4 : 0.1) + (0.35 * quality) + (0.25 * latencyScore)))
        .toFixed(4)
    );

    return {
      provider: compact(provider),
      expectedMargin,
      revenuePotential,
      confidence,
      recommendation: expectedMargin >= minExpectedMargin ? 'prioritize' : 'watchlist',
    };
  })
  .sort((a: any, b: any) => b.revenuePotential - a.revenuePotential || b.confidence - a.confidence);

  return JSON.stringify({
    marketplaceUrl,
    strategy,
    category: category || null,
    protocol,
    minExpectedMargin,
    evaluated: opportunityRows.length,
    opportunities: opportunityRows,
    generatedAt: new Date().toISOString(),
  });
};

const roiForecast: ToolHandler = async (raw) => {
  const input = parseInput<RoiForecastInput>(raw);
  const baselinePriceUsd = Math.max(0.0001, toNumber(input.baselinePriceUsd, 0.01));
  const estimatedMonthlyRequests = Math.max(10, toNumber(input.estimatedMonthlyRequests, 500));
  const costPerRequestUsd = Math.max(0.00001, toNumber(input.costPerRequestUsd, baselinePriceUsd * 0.7));
  const scenarios = input.scenarios?.length
    ? input.scenarios
    : [baselinePriceUsd * 0.9, baselinePriceUsd, baselinePriceUsd * 1.2];

  const forecasts = scenarios.map((priceRaw) => {
    const price = Math.max(0.0001, Number(priceRaw));
    const conversionMultiplier = price <= baselinePriceUsd ? 1.08 : Math.max(0.7, 1 - ((price - baselinePriceUsd) / baselinePriceUsd) * 0.35);
    const requests = Math.max(1, Math.round(estimatedMonthlyRequests * conversionMultiplier));
    const revenue = price * requests;
    const cost = costPerRequestUsd * requests;
    const grossProfit = revenue - cost;
    const roi = cost <= 0 ? 0 : grossProfit / cost;
    return {
      scenarioPriceUsd: Number(price.toFixed(6)),
      projectedRequests: requests,
      projectedRevenueUsd: Number(revenue.toFixed(4)),
      projectedCostUsd: Number(cost.toFixed(4)),
      projectedGrossProfitUsd: Number(grossProfit.toFixed(4)),
      projectedRoi: Number(roi.toFixed(4)),
      recommendation: grossProfit > 0 ? 'viable' : 'revise-pricing',
    };
  }).sort((a, b) => b.projectedGrossProfitUsd - a.projectedGrossProfitUsd);

  const best = forecasts[0] || null;

  return JSON.stringify({
    baselinePriceUsd: Number(baselinePriceUsd.toFixed(6)),
    estimatedMonthlyRequests,
    costPerRequestUsd: Number(costPerRequestUsd.toFixed(6)),
    forecasts,
    bestScenario: best,
    guardrails: [
      're-evaluate estimates weekly against actual paid request counts',
      'cap discount experiments to avoid negative gross margin',
      'adjust target scenarios when provider latency or quality shifts materially',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const executionPlaybook: ToolHandler = async (raw) => {
  const input = parseInput<ExecutionPlaybookInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const goal = (input.goal || 'increase paid usage').toLowerCase();
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const budgetUsd = Math.max(0.01, toNumber(input.budgetUsd, 1));
  const horizonDays = Math.max(1, Math.min(90, toNumber(input.horizonDays, 30)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol);

  const ranked = providers
    .map((provider: any) => {
      const quality = Math.min(1, providerQuality(provider) / 100);
      const latencyScore = Math.max(0, 1 - (providerLatencyMs(provider) / 4000));
      const modelCount = Array.isArray(provider.models) ? provider.models.length : 0;
      const capacityScore = Math.min(1, modelCount / 20);
      const executionFit = Number(((quality * 0.45) + (latencyScore * 0.25) + (capacityScore * 0.2) + (providerOnline(provider) ? 0.1 : 0)).toFixed(4));
      return { provider: compact(provider), executionFit };
    })
    .sort((a, b) => b.executionFit - a.executionFit);

  const top = ranked.slice(0, 5);

  return JSON.stringify({
    marketplaceUrl,
    goal,
    category: category || null,
    protocol,
    budgetUsd: Number(budgetUsd.toFixed(4)),
    horizonDays,
    primaryTargets: top,
    playbook: [
      'Week 1: launch revenue-focused docs updates and high-intent model examples',
      'Week 2: run paid acquisition experiments on top two execution-fit providers',
      'Week 3: optimize pricing by ROI forecast and prune negative-margin offers',
      'Week 4: automate follow-up routing to improve repeat paid usage',
    ],
    kpis: [
      'gross profit per 100 paid requests',
      'paid conversion rate from first agent interaction',
      '30-day retained paid channels',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['profitops/opportunity-scan', opportunityScan],
  ['profitops/roi-forecast', roiForecast],
  ['profitops/execution-playbook', executionPlaybook],
]);
