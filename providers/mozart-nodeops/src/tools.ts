import type { MinerBootstrapInput, ValidatorBootstrapInput, EmissionsSimInput, ToolHandler } from './types.js';

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

const minerBootstrap: ToolHandler = async (raw) => {
  const input = parseInput<MinerBootstrapInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnet, 13)));
  const strategy = (input.strategy || 'balanced').toLowerCase();
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const budgetUsd = Math.max(0.01, toNumber(input.budgetUsd, 500));
  const maxOpsPerDay = Math.max(1, Math.floor(toNumber(input.maxOpsPerDay, 25)));
  const limit = Math.max(1, Math.min(30, toNumber(input.limit, 10)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .slice(0, limit);

  const bootstrapRows = providers.map((provider: any) => {
    const modelCount = Array.isArray(provider.models) ? provider.models.length : 0;
    const online = providerOnline(provider);
    const quality = Math.min(1, providerQuality(provider) / 100);
    const latency = providerLatencyMs(provider);
    const latencyScore = latency >= 99999 ? 0 : Math.max(0, 1 - latency / 3000);
    const setupComplexity = Math.min(0.95, Number((0.25 + (0.45 * (1 - quality)) + (0.25 * (1 - latencyScore))).toFixed(4)));
    const strategyWeight = strategy === 'aggressive'
      ? 1.15
      : strategy === 'conservative'
        ? 0.9
        : 1.0;
    const opsCapacityScore = Math.min(1, maxOpsPerDay / 60);
    const expectedDailyYieldUsd = Number(
      Math.max(0.1, ((quality * 15) + (latencyScore * 8) + (modelCount * 0.25)) * strategyWeight).toFixed(4)
    );
    const estimatedMonthlyYieldUsd = Number((expectedDailyYieldUsd * 30).toFixed(4));
    const confidence = Number(Math.min(1, Math.max(0.08, (online ? 0.45 : 0.1) + (0.3 * quality) + (0.25 * latencyScore))).toFixed(4));
    const breakEvenDays = Number((budgetUsd / Math.max(0.1, expectedDailyYieldUsd)).toFixed(2));

    return {
      provider: compact(provider),
      subnet,
      setupComplexity,
      expectedDailyYieldUsd,
      estimatedMonthlyYieldUsd,
      breakEvenDays,
      opsCapacityScore: Number(opsCapacityScore.toFixed(4)),
      confidence,
      recommendation: breakEvenDays <= 45 ? 'launch-miner' : 'optimize-before-launch',
    };
  })
  .sort((a: any, b: any) => a.breakEvenDays - b.breakEvenDays || b.confidence - a.confidence);

  return JSON.stringify({
    marketplaceUrl,
    subnet,
    strategy,
    category: category || null,
    protocol,
    budgetUsd: Number(budgetUsd.toFixed(4)),
    maxOpsPerDay,
    evaluated: bootstrapRows.length,
    minerBootstrapPlan: bootstrapRows,
    rolloutChecklist: [
      'prepare wallet + hotkey and confirm chain funding',
      'deploy miner process with health monitoring and auto-restart',
      'connect telemetry for yield, latency, and failed task alerts',
      'run first 72h tuning cycle before increasing spend',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const validatorBootstrap: ToolHandler = async (raw) => {
  const input = parseInput<ValidatorBootstrapInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnet, 13)));
  const delegationUsd = Math.max(100, toNumber(input.delegationUsd, 3000));
  const infraCostUsdMonthly = Math.max(10, toNumber(input.infraCostUsdMonthly, 250));
  const targetDelegators = Math.max(1, Math.floor(toNumber(input.targetDelegators, 20)));
  const commissionRate = Math.max(0.01, Math.min(0.5, toNumber(input.commissionRate, 0.08)));
  const strategy = (input.strategy || 'balanced').toLowerCase();
  const strategyMult = strategy === 'aggressive' ? 1.2 : strategy === 'conservative' ? 0.85 : 1.0;

  const monthlyGrossRewardsUsd = Number(((delegationUsd * 0.06 * strategyMult) + (targetDelegators * 12)).toFixed(4));
  const validatorRevenueUsd = Number((monthlyGrossRewardsUsd * commissionRate).toFixed(4));
  const monthlyNetUsd = Number((validatorRevenueUsd - infraCostUsdMonthly).toFixed(4));
  const breakEvenMonths = Number((infraCostUsdMonthly / Math.max(1, validatorRevenueUsd)).toFixed(2));
  const confidence = Number(Math.min(1, Math.max(0.1, 0.35 + (targetDelegators / 60) + (commissionRate * 0.5))).toFixed(4));

  const rolePlan = {
    subnet,
    targetDelegators,
    delegationUsd: Number(delegationUsd.toFixed(4)),
    commissionRate: Number(commissionRate.toFixed(4)),
    infraCostUsdMonthly: Number(infraCostUsdMonthly.toFixed(4)),
    monthlyGrossRewardsUsd,
    validatorRevenueUsd,
    monthlyNetUsd,
    breakEvenMonths,
    confidence,
    recommendation: monthlyNetUsd > 0 ? 'launch-validator' : 'raise-delegation-before-launch',
  };

  return JSON.stringify({
    strategy,
    validatorBootstrapPlan: rolePlan,
    activationSteps: [
      'publish validator thesis and expected subnet support policy',
      'establish delegator reporting cadence (weekly emissions + uptime)',
      'configure slashing/risk alerts and automated incident escalation',
      'run 30-day delegation acquisition campaign with transparent ROI reporting',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const emissionsSim: ToolHandler = async (raw) => {
  const input = parseInput<EmissionsSimInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnet, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const infraCostUsdMonthly = Math.max(10, toNumber(input.infraCostUsdMonthly, role === 'validator' ? 250 : 120));
  const stakeUsd = Math.max(0, toNumber(input.stakeUsd, role === 'validator' ? 5000 : 1500));
  const uptime = Math.max(0.5, Math.min(1, toNumber(input.uptime, 0.95)));
  const qualityScore = Math.max(0.1, Math.min(1, toNumber(input.qualityScore, 0.75)));
  const horizonDays = Math.max(7, Math.min(180, Math.floor(toNumber(input.horizonDays, 30))));
  const marketVolatility = Math.max(0, Math.min(1, toNumber(input.marketVolatility, 0.25)));

  const baseDailyEmissionUsd = role === 'validator'
    ? (stakeUsd * 0.0009)
    : (stakeUsd * 0.0012);
  const adjustedDailyEmissionUsd = baseDailyEmissionUsd * uptime * (0.6 + (0.6 * qualityScore));
  const volatilityPenalty = 1 - (marketVolatility * 0.35);
  const netDailyUsd = (adjustedDailyEmissionUsd * volatilityPenalty) - (infraCostUsdMonthly / 30);
  const projectedNetUsd = Number((netDailyUsd * horizonDays).toFixed(4));
  const projectedGrossUsd = Number((adjustedDailyEmissionUsd * horizonDays).toFixed(4));
  const breakEvenDays = netDailyUsd <= 0 ? null : Number((infraCostUsdMonthly / netDailyUsd).toFixed(2));
  const confidence = Number(Math.min(1, Math.max(0.05, (uptime * 0.5) + (qualityScore * 0.35) - (marketVolatility * 0.25))).toFixed(4));

  const scenarios = [
    { name: 'downside', multiplier: 0.75 },
    { name: 'base', multiplier: 1.0 },
    { name: 'upside', multiplier: 1.25 },
  ].map((s) => {
    const gross = adjustedDailyEmissionUsd * s.multiplier * horizonDays;
    const net = gross - ((infraCostUsdMonthly / 30) * horizonDays);
    return {
      scenario: s.name,
      projectedGrossUsd: Number(gross.toFixed(4)),
      projectedNetUsd: Number(net.toFixed(4)),
    };
  });

  return JSON.stringify({
    subnet,
    role,
    infraCostUsdMonthly: Number(infraCostUsdMonthly.toFixed(4)),
    stakeUsd: Number(stakeUsd.toFixed(4)),
    uptime: Number(uptime.toFixed(4)),
    qualityScore: Number(qualityScore.toFixed(4)),
    marketVolatility: Number(marketVolatility.toFixed(4)),
    horizonDays,
    projectedGrossUsd,
    projectedNetUsd,
    breakEvenDays,
    confidence,
    scenarios,
    recommendation: projectedNetUsd > 0 ? 'allocate-and-launch' : 'improve-quality-or-reduce-cost',
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['nodeops/miner-bootstrap', minerBootstrap],
  ['nodeops/validator-bootstrap', validatorBootstrap],
  ['nodeops/emissions-sim', emissionsSim],
]);
