import type {
  ServiceReadinessInput,
  ReleaseChecklistInput,
  PostLaunchTuningInput,
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

const serviceReadiness: ToolHandler = async (raw) => {
  const input = parseInput<ServiceReadinessInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(process.env.MARKETPLACE_URL);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const environment = input.environment || 'prod';
  const teamSize = Math.max(1, Math.floor(toNumber(input.teamSize, 3)));
  const targetLaunchDays = Math.max(1, Math.min(90, Math.floor(toNumber(input.targetLaunchDays, 14))));
  const budgetUsdMonthly = Math.max(50, toNumber(input.budgetUsdMonthly, role === 'validator' ? 1200 : 600));
  const reliabilityTarget = Math.max(0.8, Math.min(0.999, toNumber(input.reliabilityTarget, 0.97)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=250`);
  const providers = normalizeProviders(data).slice(0, 25);

  const readinessRows = providers.map((provider: any) => {
    const online = providerOnline(provider);
    const latencyScore = Math.max(0, 1 - providerLatencyMs(provider) / 3000);
    const qualityScore = Math.min(1, providerQuality(provider) / 100);
    const providerReadiness = Math.min(1, 0.55 * qualityScore + 0.3 * latencyScore + (online ? 0.15 : 0.05));
    const teamFactor = Math.min(1, teamSize / 6);
    const scheduleRisk = Math.min(1, 1 - targetLaunchDays / 45);
    const budgetFit = Math.min(1, budgetUsdMonthly / (role === 'validator' ? 1500 : 800));
    const readinessScore = Number(
      Math.min(1, Math.max(0.05, 0.42 * providerReadiness + 0.25 * teamFactor + 0.2 * budgetFit + 0.13 * (1 - scheduleRisk)))
        .toFixed(4)
    );
    const reliabilityGap = Number(Math.max(0, reliabilityTarget - (0.88 + (providerReadiness * 0.1))).toFixed(4));

    return {
      provider: compact(provider),
      subnet,
      role,
      environment,
      readinessScore,
      reliabilityGap,
      recommendation: readinessScore >= 0.7 ? 'ready-for-rollout' : 'close-gaps-first',
    };
  })
  .sort((a: any, b: any) => b.readinessScore - a.readinessScore || a.reliabilityGap - b.reliabilityGap);

  return JSON.stringify({
    marketplaceUrl,
    subnet,
    role,
    environment,
    teamSize,
    targetLaunchDays,
    budgetUsdMonthly: Number(budgetUsdMonthly.toFixed(4)),
    reliabilityTarget: Number(reliabilityTarget.toFixed(4)),
    evaluated: readinessRows.length,
    serviceReadiness: readinessRows.slice(0, 10),
    actionPlan: [
      'verify infra templates and secret management before rollout',
      'run smoke tests in staging with production-like load shape',
      'enable alerts for uptime, latency, and failed payouts before launch',
      'set release freeze and explicit rollback owner for launch window',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const releaseChecklist: ToolHandler = async (raw) => {
  const input = parseInput<ReleaseChecklistInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const releaseType = input.releaseType || 'feature';
  const changeRisk = input.changeRisk || 'medium';
  const requiresMigration = Boolean(input.requiresMigration);
  const rollbackWindowMinutes = Math.max(10, Math.floor(toNumber(input.rollbackWindowMinutes, 45)));
  const maintenanceWindowUtc = input.maintenanceWindowUtc || '02:00-03:00';

  const riskWeight = changeRisk === 'high' ? 1.2 : changeRisk === 'low' ? 0.85 : 1.0;
  const migrationWeight = requiresMigration ? 1.15 : 0.95;
  const roleWeight = role === 'validator' ? 1.1 : 1.0;
  const releaseComplexity = Number(Math.min(1, 0.42 * riskWeight + 0.33 * migrationWeight + 0.25 * roleWeight).toFixed(4));

  return JSON.stringify({
    subnet,
    role,
    releaseType,
    changeRisk,
    requiresMigration,
    rollbackWindowMinutes,
    maintenanceWindowUtc,
    releaseComplexity,
    checklist: [
      { stage: 'preflight', item: 'validate health checks, wallet funding, and dependency versions', required: true },
      { stage: 'preflight', item: 'freeze config changes and verify secret parity across environments', required: true },
      { stage: 'release', item: 'run canary rollout with rollback observer in call', required: true },
      { stage: 'release', item: 'verify payout pipeline and channel settlement logs', required: true },
      { stage: 'post', item: 'collect 60-minute metrics window and compare to baseline', required: true },
      { stage: 'post', item: requiresMigration ? 'confirm migration integrity and backup checkpoints' : 'log release completion in runbook', required: true },
    ],
    recommendation: releaseComplexity > 0.8 ? 'staged-rollout-mandatory' : 'standard-rollout-ok',
    generatedAt: new Date().toISOString(),
  });
};

const postLaunchTuning: ToolHandler = async (raw) => {
  const input = parseInput<PostLaunchTuningInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const currentDailyCostUsd = Math.max(1, toNumber(input.currentDailyCostUsd, role === 'validator' ? 45 : 24));
  const dailyRevenueUsd = Math.max(0, toNumber(input.dailyRevenueUsd, role === 'validator' ? 58 : 29));
  const uptime = Math.max(0.5, Math.min(1, toNumber(input.uptime, 0.96)));
  const avgLatencyMs = Math.max(10, toNumber(input.avgLatencyMs, role === 'validator' ? 420 : 320));
  const incidentRatePerWeek = Math.max(0, toNumber(input.incidentRatePerWeek, 1.2));
  const horizonDays = Math.max(7, Math.min(120, Math.floor(toNumber(input.horizonDays, 30))));

  const marginDailyUsd = dailyRevenueUsd - currentDailyCostUsd;
  const latencyPenalty = Math.min(0.35, Math.max(0, (avgLatencyMs - 250) / 2000));
  const reliabilityPenalty = Math.min(0.45, Math.max(0, (1 - uptime) * 2.2 + incidentRatePerWeek * 0.04));
  const optimizationHeadroom = Number(Math.max(0.05, 0.42 - latencyPenalty - reliabilityPenalty).toFixed(4));
  const projectedDeltaUsd = Number((marginDailyUsd * optimizationHeadroom * horizonDays).toFixed(4));
  const tunedDailyProfitUsd = Number((marginDailyUsd * (1 + optimizationHeadroom)).toFixed(4));
  const confidence = Number(Math.min(1, Math.max(0.1, 0.5 * uptime + 0.3 * (1 - Math.min(1, avgLatencyMs / 2500)) + 0.2 * (1 - Math.min(1, incidentRatePerWeek / 8)))).toFixed(4));

  const scenarios = [
    { name: 'downside', multiplier: 0.85 },
    { name: 'base', multiplier: 1.0 },
    { name: 'upside', multiplier: 1.2 },
  ].map((s) => {
    const net = tunedDailyProfitUsd * s.multiplier * horizonDays;
    const gross = (dailyRevenueUsd * (1 + optimizationHeadroom * 0.8)) * s.multiplier * horizonDays;
    return {
      scenario: s.name,
      projectedGrossUsd: Number(gross.toFixed(4)),
      projectedNetUsd: Number(net.toFixed(4)),
    };
  });

  return JSON.stringify({
    subnet,
    role,
    currentDailyCostUsd: Number(currentDailyCostUsd.toFixed(4)),
    dailyRevenueUsd: Number(dailyRevenueUsd.toFixed(4)),
    uptime: Number(uptime.toFixed(4)),
    avgLatencyMs: Number(avgLatencyMs.toFixed(4)),
    incidentRatePerWeek: Number(incidentRatePerWeek.toFixed(4)),
    horizonDays,
    optimizationHeadroom,
    projectedDeltaUsd,
    tunedDailyProfitUsd,
    confidence,
    scenarios,
    recommendation: tunedDailyProfitUsd > 0 ? 'apply-tuning-plan' : 'stabilize-before-scaling',
    tuningActions: [
      'tighten autoscaling + queue limits to cut idle compute waste',
      'move slow tasks to async workers and protect hot request path',
      'add SLO-based alert routing with 15-minute ownership windows',
      'review incident postmortems weekly and prune recurring failure modes',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['deployops/service-readiness', serviceReadiness],
  ['deployops/release-checklist', releaseChecklist],
  ['deployops/post-launch-tuning', postLaunchTuning],
]);
