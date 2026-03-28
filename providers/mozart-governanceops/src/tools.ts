import type { PolicyCheckInput, ControlMatrixInput, ReleaseApprovalInput, ToolHandler } from './types.js';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MARKETPLACE_URL = 'https://handshake58.com';

const CONTROL_CATALOG = [
  'docs_url',
  'api_url',
  'model_inventory',
  'quality_signal',
  'latency_slo',
  'online_status',
  'category_alignment',
];

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

function compactProvider(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    category: provider.category || 'unknown',
    protocol: provider.protocol || 'unknown',
    tier: provider.tier || 'unknown',
    online: providerOnline(provider),
    qualityScore: Number(providerQuality(provider).toFixed(4)),
    score: Number(toNumber(provider.score, 0).toFixed(4)),
    latencyMs: providerLatencyMs(provider),
    modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
    apiUrl: provider.apiUrl || null,
    docsUrl: provider.docsUrl || null,
  };
}

function controlCoverage(provider: any, requiredControls?: string[]) {
  const requested = Array.from(new Set((requiredControls && requiredControls.length > 0 ? requiredControls : CONTROL_CATALOG).map((x) => String(x).toLowerCase())));
  const models = Array.isArray(provider.models) ? provider.models : [];
  const latency = providerLatencyMs(provider);
  const quality = providerQuality(provider);

  const implemented = new Set<string>();
  if (provider.docsUrl && String(provider.docsUrl).trim().length > 0) implemented.add('docs_url');
  if (provider.apiUrl && String(provider.apiUrl).trim().length > 0) implemented.add('api_url');
  if (models.length > 0) implemented.add('model_inventory');
  if (quality >= 60) implemented.add('quality_signal');
  if (latency <= 3500) implemented.add('latency_slo');
  if (providerOnline(provider)) implemented.add('online_status');
  if (provider.category) implemented.add('category_alignment');

  const missing = requested.filter((item) => !implemented.has(item));
  const score = requested.length > 0 ? (requested.length - missing.length) / requested.length : 0;

  return {
    requestedControls: requested,
    implementedControls: requested.filter((item) => implemented.has(item)),
    missingControls: missing,
    coverageScore: Number(score.toFixed(4)),
  };
}

const policyCheck: ToolHandler = async (raw) => {
  const input = parseInput<PolicyCheckInput>(raw);
  if (!input.providerName || !input.providerName.trim()) {
    return JSON.stringify({ error: 'providerName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const providerName = input.providerName.trim().toLowerCase();
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || '').toLowerCase();
  const minQualityScore = Math.max(0, toNumber(input.minQualityScore, 0));
  const maxProviders = Math.max(1, Math.min(20, toNumber(input.maxProviders, 6)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data);

  const matches = providers
    .filter((provider: any) => String(provider.name || '').toLowerCase().includes(providerName))
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => !protocol || String(provider.protocol || '').toLowerCase() === protocol)
    .map((provider: any) => {
      const quality = providerQuality(provider);
      const latency = providerLatencyMs(provider);
      const controls = controlCoverage(provider);
      const violations: string[] = [];
      if (!providerOnline(provider)) violations.push('provider_offline');
      if (quality < minQualityScore) violations.push('quality_below_threshold');
      if (latency > 5000) violations.push('latency_above_policy');
      if (controls.missingControls.length > 0) violations.push('control_gaps');

      const policyScore = Math.max(0, (controls.coverageScore * 0.55) + (Math.min(1, quality / 100) * 0.25) + (latency <= 3500 ? 0.2 : 0));
      const decision = violations.length === 0 ? 'compliant' : violations.length <= 2 ? 'conditional' : 'non_compliant';

      return {
        provider: compactProvider(provider),
        policyScore: Number(policyScore.toFixed(4)),
        decision,
        violations,
        controls,
      };
    })
    .sort((a: any, b: any) => b.policyScore - a.policyScore)
    .slice(0, maxProviders);

  return JSON.stringify({
    marketplaceUrl,
    providerName: input.providerName,
    evaluated: matches.length,
    results: matches,
    generatedAt: new Date().toISOString(),
  });
};

const controlMatrix: ToolHandler = async (raw) => {
  const input = parseInput<ControlMatrixInput>(raw);

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const protocol = (input.protocol || 'all').toLowerCase();
  const limit = Math.max(1, Math.min(40, toNumber(input.limit, 15)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => providerOnline(provider))
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => protocol === 'all' || String(provider.protocol || '').toLowerCase() === protocol)
    .slice(0, limit);

  const matrix = providers.map((provider: any) => {
    const coverage = controlCoverage(provider, input.requiredControls);
    return {
      provider: compactProvider(provider),
      ...coverage,
    };
  });

  const aggregateCoverage = matrix.length
    ? matrix.reduce((acc: number, item: any) => acc + item.coverageScore, 0) / matrix.length
    : 0;

  const dominantMissing = matrix
    .flatMap((item: any) => item.missingControls)
    .reduce((acc: Record<string, number>, ctrl: string) => {
      acc[ctrl] = (acc[ctrl] || 0) + 1;
      return acc;
    }, {});

  const missingRanking = Object.entries(dominantMissing)
    .sort((a, b) => b[1] - a[1])
    .map(([control, count]) => ({ control, count }));

  return JSON.stringify({
    marketplaceUrl,
    category: category || null,
    protocol,
    providersAnalyzed: matrix.length,
    aggregateCoverage: Number(aggregateCoverage.toFixed(4)),
    topMissingControls: missingRanking.slice(0, 6),
    matrix,
    generatedAt: new Date().toISOString(),
  });
};

const releaseApproval: ToolHandler = async (raw) => {
  const input = parseInput<ReleaseApprovalInput>(raw);
  if (!input.candidateName || !input.candidateName.trim()) {
    return JSON.stringify({ error: 'candidateName is required' });
  }

  const marketplaceUrl = marketplaceUrlFrom(input.marketplaceUrl);
  const category = (input.category || '').toLowerCase();
  const targetProtocol = (input.targetProtocol || 'drain').toLowerCase();
  const minimumReadinessScore = Math.max(0, Math.min(1, toNumber(input.minimumReadinessScore, 0.72)));
  const minBenchmarkCount = Math.max(1, Math.min(30, toNumber(input.minBenchmarkCount, 6)));

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=300`);
  const providers = normalizeProviders(data)
    .filter((provider: any) => providerOnline(provider))
    .filter((provider: any) => !category || String(provider.category || '').toLowerCase() === category)
    .filter((provider: any) => targetProtocol === 'all' || String(provider.protocol || '').toLowerCase() === targetProtocol);

  const benchmarks = providers
    .map((provider: any) => {
      const coverage = controlCoverage(provider);
      const quality = providerQuality(provider);
      const latency = providerLatencyMs(provider);
      const readiness = Math.min(1, (coverage.coverageScore * 0.5) + (Math.min(1, quality / 100) * 0.3) + (latency <= 3500 ? 0.2 : 0.08));
      return {
        provider,
        coverageScore: coverage.coverageScore,
        readiness,
        quality,
        latency,
      };
    })
    .sort((a: any, b: any) => b.readiness - a.readiness)
    .slice(0, Math.max(minBenchmarkCount, 10));

  const avgReadiness = benchmarks.length ? benchmarks.reduce((acc: number, x: any) => acc + x.readiness, 0) / benchmarks.length : 0.7;
  const avgQuality = benchmarks.length ? benchmarks.reduce((acc: number, x: any) => acc + x.quality, 0) / benchmarks.length : 65;

  const simulatedCandidateScore = Math.min(1, (avgReadiness * 0.62) + (Math.min(1, avgQuality / 100) * 0.28) + 0.1);

  const decision = simulatedCandidateScore >= minimumReadinessScore
    ? 'approve'
    : simulatedCandidateScore >= (minimumReadinessScore - 0.1)
      ? 'conditional'
      : 'block';

  const requiredActions = [
    'publish docs URL with model-specific usage examples',
    'confirm API URL health and 200 response under 10s',
    'maintain qualityScore >= benchmark median',
    'keep latency under governance target where possible',
  ];

  return JSON.stringify({
    marketplaceUrl,
    candidateName: input.candidateName,
    category: category || null,
    targetProtocol,
    benchmarkCount: benchmarks.length,
    minimumReadinessScore,
    readinessScore: Number(simulatedCandidateScore.toFixed(4)),
    decision,
    requiredActions,
    benchmarkSummary: {
      avgReadiness: Number(avgReadiness.toFixed(4)),
      avgQualityScore: Number(avgQuality.toFixed(2)),
    },
    topBenchmarks: benchmarks.slice(0, 5).map((x: any) => ({
      provider: compactProvider(x.provider),
      readiness: Number(x.readiness.toFixed(4)),
      coverageScore: Number(x.coverageScore.toFixed(4)),
      latencyMs: x.latency,
    })),
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['governanceops/policy-check', policyCheck],
  ['governanceops/control-matrix', controlMatrix],
  ['governanceops/release-approval', releaseApproval],
]);
