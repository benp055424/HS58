import type { FunnelAuditInput, PricingExperimentInput, RetentionPlaybookInput, ToolHandler } from './types.js';

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

const funnelAudit: ToolHandler = async (raw) => {
  const input = parseInput<FunnelAuditInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const targetProvider = (input.targetProvider || '').toLowerCase();
  const limit = Math.max(1, Math.min(30, toNumber(input.limit, 12)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .filter((provider: any) => !targetProvider || String(provider.name || '').toLowerCase().includes(targetProvider))
    .slice(0, limit);

  const funnelRows = providers.map((provider: any) => {
    const docs = provider.docsUrl && String(provider.docsUrl).trim().length > 0;
    const api = provider.apiUrl && String(provider.apiUrl).trim().length > 0;
    const models = Array.isArray(provider.models) ? provider.models.length : 0;
    const online = providerOnline(provider);
    const quality = providerQuality(provider);
    const readiness = (docs ? 0.25 : 0) + (api ? 0.25 : 0) + (models > 0 ? 0.25 : 0) + (online && quality >= 60 ? 0.25 : 0);
    return {
      provider: compact(provider),
      funnelScore: Number(readiness.toFixed(4)),
      stageGaps: [
        ...(docs ? [] : ['docs_missing']),
        ...(api ? [] : ['api_missing']),
        ...(models > 0 ? [] : ['models_missing']),
        ...(online ? [] : ['health_missing']),
      ],
    };
  }).sort((a: any, b: any) => b.funnelScore - a.funnelScore);

  return JSON.stringify({
    marketplaceUrl,
    category: category || null,
    protocol,
    evaluated: funnelRows.length,
    funnelRows,
    generatedAt: new Date().toISOString(),
  });
};

const pricingExperiment: ToolHandler = async (raw) => {
  const input = parseInput<PricingExperimentInput>(raw);
  const baseline = Math.max(0.0001, toNumber(input.baselinePriceUsd, 0.005));
  const variants = (input.variantPricesUsd && input.variantPricesUsd.length > 0
    ? input.variantPricesUsd
    : [baseline * 0.8, baseline * 1.1, baseline * 1.3]).map((n) => Number(Math.max(0.0001, n).toFixed(6)));
  const targetConversionRate = Math.max(0.01, Math.min(1, toNumber(input.targetConversionRate, 0.12)));

  const plans = variants.map((price) => {
    const delta = (price - baseline) / baseline;
    const projectedConversion = Math.max(0.01, targetConversionRate - (delta * 0.08));
    const projectedRevenueIndex = projectedConversion * price;
    return {
      variantPriceUsd: price,
      projectedConversionRate: Number(projectedConversion.toFixed(4)),
      projectedRevenueIndex: Number(projectedRevenueIndex.toFixed(6)),
      recommendation: projectedRevenueIndex >= (targetConversionRate * baseline) ? 'test' : 'low-priority',
    };
  }).sort((a, b) => b.projectedRevenueIndex - a.projectedRevenueIndex);

  return JSON.stringify({
    baselinePriceUsd: Number(baseline.toFixed(6)),
    targetConversionRate,
    experimentVariants: plans,
    winnerCandidate: plans[0] || null,
    guardrails: [
      'keep price changes within +/-35% per experiment',
      'run each variant for at least one full traffic cycle',
      'monitor retention impact before promoting winning variant',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const retentionPlaybook: ToolHandler = async (raw) => {
  const input = parseInput<RetentionPlaybookInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const targetProvider = (input.targetProvider || '').toLowerCase();
  const cadenceDays = Math.max(1, Math.min(30, toNumber(input.cadenceDays, 7)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .filter((provider: any) => !targetProvider || String(provider.name || '').toLowerCase().includes(targetProvider));

  const atRisk = providers
    .filter((provider: any) => !providerOnline(provider) || providerLatencyMs(provider) > 3500 || providerQuality(provider) < 60)
    .slice(0, 10)
    .map(compact);

  return JSON.stringify({
    marketplaceUrl,
    category: category || null,
    protocol,
    targetProvider: targetProvider || null,
    cadenceDays,
    atRiskProviders: atRisk,
    retentionTactics: [
      'publish predictable changelog and model availability schedule',
      'add fallback model recommendations to docs for continuity',
      'monitor latency SLO weekly and notify users proactively',
      'run monthly pricing/value review to reduce churn drivers',
    ],
    successMetrics: [
      'repeat usage ratio',
      'median weekly requests per active channel',
      'provider churn rate',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['growthops/funnel-audit', funnelAudit],
  ['growthops/pricing-experiment', pricingExperiment],
  ['growthops/retention-playbook', retentionPlaybook],
]);
