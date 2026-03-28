import type { TriageBriefInput, FallbackSimInput, PostmortemDraftInput, ToolHandler } from './types.js';

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

function providerScore(provider: any): number {
  return toNumber(provider?.score ?? provider?.qualityScore, 0);
}

function extractModelId(model: any): string {
  return String(model?.modelId || model?.id || model?.name || '').trim();
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
    qualityScore: Number(providerQuality(provider).toFixed(4)),
    score: Number(providerScore(provider).toFixed(4)),
    latencyMs: providerLatencyMs(provider),
    modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
  };
}

const triageBrief: ToolHandler = async (raw) => {
  const input = parseInput<TriageBriefInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const maxProviders = Math.max(1, Math.min(15, toNumber(input.maxProviders, 8)));
  const latencyThresholdMs = Math.max(100, toNumber(input.latencyThresholdMs, 3500));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .slice(0, 200);

  const offline = providers.filter((provider: any) => !providerOnline(provider));
  const degraded = providers.filter((provider: any) => providerOnline(provider) && providerLatencyMs(provider) > latencyThresholdMs);
  const lowQuality = providers.filter((provider: any) => providerQuality(provider) < 55);

  const severity = offline.length >= 5 || degraded.length >= 10
    ? 'sev1'
    : offline.length >= 2 || degraded.length >= 5
      ? 'sev2'
      : degraded.length > 0 || lowQuality.length > 0
        ? 'sev3'
        : 'sev4';

  const affected = [...offline, ...degraded].slice(0, maxProviders).map(compactProvider);

  return JSON.stringify({
    incidentName: input.incidentName || 'Unnamed incident',
    marketplaceUrl,
    category: category || null,
    protocol,
    severity,
    totals: {
      providersSeen: providers.length,
      offline: offline.length,
      degradedLatency: degraded.length,
      lowQuality: lowQuality.length,
    },
    affectedProviders: affected,
    immediateActions: [
      'activate fallback routing for degraded categories',
      'notify provider owners for offline services',
      'reduce traffic to high-latency providers',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const fallbackSim: ToolHandler = async (raw) => {
  const input = parseInput<FallbackSimInput>(raw);
  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const modelHint = input.modelHint?.trim();
  const maxAlternatives = Math.max(1, Math.min(10, toNumber(input.maxAlternatives, 4)));
  const failed = new Set((input.failedProviders || []).map((s) => s.toLowerCase()));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => providerOnline(provider))
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol);

  const candidates = providers
    .filter((provider: any) => !failed.has(String(provider.name || '').toLowerCase()))
    .map((provider: any) => ({
      provider,
      reliability: Math.min(1, providerQuality(provider) / 100),
      latencyScore: Math.max(0, 1 - (providerLatencyMs(provider) / 7000)),
      unitCostUsd: unitCost(provider, modelHint),
    }))
    .sort((a: any, b: any) =>
      ((b.reliability + b.latencyScore) - (a.reliability + a.latencyScore)) ||
      (a.unitCostUsd - b.unitCostUsd)
    )
    .slice(0, maxAlternatives);

  return JSON.stringify({
    marketplaceUrl,
    category: category || null,
    protocol,
    modelHint: modelHint || null,
    failedProviders: Array.from(failed),
    alternatives: candidates.map((x: any) => ({
      provider: compactProvider(x.provider),
      reliability: Number(x.reliability.toFixed(4)),
      latencyScore: Number(x.latencyScore.toFixed(4)),
      estimatedUnitCostUsd: Number(x.unitCostUsd.toFixed(6)),
      expectedImpact: x.latencyScore < 0.5 ? 'higher_latency' : 'minimal',
    })),
    generatedAt: new Date().toISOString(),
  });
};

const postmortemDraft: ToolHandler = async (raw) => {
  const input = parseInput<PostmortemDraftInput>(raw);
  if (!input.incidentTitle || !input.incidentTitle.trim()) {
    return JSON.stringify({ error: 'incidentTitle is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const suspected = new Set((input.suspectedProviders || []).map((s) => s.toLowerCase()));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol);

  const impacted = providers.filter((provider: any) => {
    const name = String(provider.name || '').toLowerCase();
    return suspected.size === 0
      ? (!providerOnline(provider) || providerLatencyMs(provider) > 4000)
      : suspected.has(name);
  });

  const timelineStart = input.startTimeIso || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const timelineEnd = input.endTimeIso || new Date().toISOString();

  return JSON.stringify({
    incidentTitle: input.incidentTitle,
    summary: `Incident affected ${impacted.length} provider(s) in ${category || 'all categories'} scope.`,
    timeframe: {
      start: timelineStart,
      end: timelineEnd,
    },
    impactedProviders: impacted.slice(0, 12).map(compactProvider),
    likelyRootCauses: [
      'provider-side availability instability',
      'upstream latency regression',
      'insufficient fallback coverage in active route set',
    ],
    remediationPlan: [
      'add at least 2 fallback providers per critical category',
      'enforce latency/quality guardrails in routing logic',
      'run weekly incident simulation and validation drills',
    ],
    followUpOwners: [
      'routing-ops',
      'provider-relations',
      'incident-commander',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['incidentops/triage-brief', triageBrief],
  ['incidentops/fallback-sim', fallbackSim],
  ['incidentops/postmortem-draft', postmortemDraft],
]);
