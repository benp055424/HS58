import type { SlaGuardrailInput, BreachPredictInput, RemediationPlanInput, ToolHandler } from './types.js';

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

const slaGuardrail: ToolHandler = async (raw) => {
  const input = parseInput<SlaGuardrailInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const targetLatencyMs = Math.max(100, toNumber(input.targetLatencyMs, 3000));
  const minQualityScore = Math.max(0, toNumber(input.minQualityScore, 60));
  const minAvailabilityRatio = Math.max(0, Math.min(1, toNumber(input.minAvailabilityRatio, 0.9)));
  const limit = Math.max(1, Math.min(30, toNumber(input.limit, 15)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .slice(0, limit);

  const onlineCount = providers.filter(providerOnline).length;
  const availabilityRatio = providers.length ? onlineCount / providers.length : 0;
  const breaches = providers
    .filter((provider: any) => providerLatencyMs(provider) > targetLatencyMs || providerQuality(provider) < minQualityScore || !providerOnline(provider))
    .map((provider: any) => ({
      provider: compact(provider),
      breachReasons: [
        ...(!providerOnline(provider) ? ['offline'] : []),
        ...(providerLatencyMs(provider) > targetLatencyMs ? ['latency_slo'] : []),
        ...(providerQuality(provider) < minQualityScore ? ['quality_floor'] : []),
      ],
    }));

  return JSON.stringify({
    marketplaceUrl,
    category: category || null,
    protocol,
    targetLatencyMs,
    minQualityScore,
    minAvailabilityRatio,
    metrics: {
      providersEvaluated: providers.length,
      onlineCount,
      availabilityRatio: Number(availabilityRatio.toFixed(4)),
      breachCount: breaches.length,
    },
    breachProviders: breaches,
    slaStatus: availabilityRatio >= minAvailabilityRatio && breaches.length === 0 ? 'healthy' : 'at_risk',
    generatedAt: new Date().toISOString(),
  });
};

const breachPredict: ToolHandler = async (raw) => {
  const input = parseInput<BreachPredictInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const lookaheadMinutes = Math.max(5, Math.min(180, toNumber(input.lookaheadMinutes, 45)));
  const targetLatencyMs = Math.max(100, toNumber(input.targetLatencyMs, 3000));
  const maxProviders = Math.max(1, Math.min(20, toNumber(input.maxProviders, 8)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol);

  const predictions = providers.map((provider: any) => {
    const latency = providerLatencyMs(provider);
    const quality = providerQuality(provider);
    const online = providerOnline(provider);
    const riskScore = Math.min(1, (online ? 0 : 0.55) + Math.max(0, (latency - targetLatencyMs) / targetLatencyMs) * 0.35 + Math.max(0, (65 - quality) / 65) * 0.25);
    return {
      provider: compact(provider),
      riskScore: Number(riskScore.toFixed(4)),
      likelihood: riskScore >= 0.75 ? 'high' : riskScore >= 0.45 ? 'medium' : 'low',
      lookaheadMinutes,
    };
  }).sort((a: any, b: any) => b.riskScore - a.riskScore).slice(0, maxProviders);

  return JSON.stringify({
    marketplaceUrl,
    category: category || null,
    protocol,
    lookaheadMinutes,
    targetLatencyMs,
    predictions,
    generatedAt: new Date().toISOString(),
  });
};

const remediationPlan: ToolHandler = async (raw) => {
  const input = parseInput<RemediationPlanInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const targetLatencyMs = Math.max(100, toNumber(input.targetLatencyMs, 3000));
  const minQualityScore = Math.max(0, toNumber(input.minQualityScore, 60));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol);

  const offenders = providers.filter((provider: any) => !providerOnline(provider) || providerLatencyMs(provider) > targetLatencyMs || providerQuality(provider) < minQualityScore);

  return JSON.stringify({
    incidentLabel: input.incidentLabel || 'sla-reliability-event',
    marketplaceUrl,
    category: category || null,
    protocol,
    offenders: offenders.slice(0, 12).map(compact),
    remediationActions: [
      'shift traffic from high-risk providers to healthier alternatives',
      'tighten latency SLO alerts and auto-failover thresholds',
      'coordinate recovery with provider owners and publish status updates',
      'run synthetic checks every 5 minutes until stability restored',
    ],
    ownerChecklist: [
      { owner: 'routing-ops', action: 'update fallback weights' },
      { owner: 'provider-relations', action: 'engage impacted providers' },
      { owner: 'incident-commander', action: 'approve recovery milestones' },
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['slaops/sla-guardrail', slaGuardrail],
  ['slaops/breach-predict', breachPredict],
  ['slaops/remediation-plan', remediationPlan],
]);
