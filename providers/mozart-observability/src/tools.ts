import type { ToolHandler } from './types.js';

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MARKETPLACE_URL = 'https://handshake58.com';

function parseInput(raw: string): any {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function marketplaceUrlFromEnv(): string {
  return (process.env.MARKETPLACE_URL || DEFAULT_MARKETPLACE_URL).replace(/\/$/, '');
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

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeProviders(payload: any): any[] {
  if (Array.isArray(payload?.providers)) return payload.providers;
  if (Array.isArray(payload)) return payload;
  return [];
}

function compactProvider(p: any) {
  return {
    id: p.id,
    name: p.name,
    tier: p.tier,
    score: p.score ?? p.qualityScore ?? 0,
    category: p.category,
    isOnline: p.isOnline,
    apiUrl: p.apiUrl,
    models: Array.isArray(p.models) ? p.models.slice(0, 5).map((m: any) => m.modelId || m.id || m.name) : [],
  };
}

const providerStatus: ToolHandler = async (raw) => {
  const input = parseInput(raw);
  const marketplaceUrl = (input.marketplaceUrl || marketplaceUrlFromEnv()).replace(/\/$/, '');
  const limit = Math.max(1, Math.min(200, toNumber(input.limit, 100)));
  const minScore = Math.max(0, Math.min(1, toNumber(input.minScore, 0)));
  const category = typeof input.category === 'string' ? input.category : '';
  const tier = typeof input.tier === 'string' ? input.tier : '';

  const query = new URLSearchParams({
    format: 'full',
    limit: String(limit),
  });
  if (minScore > 0) query.set('minScore', String(minScore));
  if (category) query.set('category', category);
  if (tier) query.set('tier', tier);

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?${query.toString()}`);
  const providers = normalizeProviders(data);

  const online = providers.filter(p => p.isOnline !== false);
  const byTier = online.reduce((acc: Record<string, number>, p: any) => {
    const t = p.tier || 'unknown';
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});
  const byCategory = online.reduce((acc: Record<string, number>, p: any) => {
    const c = p.category || 'unknown';
    acc[c] = (acc[c] || 0) + 1;
    return acc;
  }, {});

  const topByScore = [...online]
    .sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0))
    .slice(0, 10)
    .map(compactProvider);

  return JSON.stringify({
    marketplaceUrl,
    scanned: providers.length,
    online: online.length,
    byTier,
    byCategory,
    topByScore,
    generatedAt: new Date().toISOString(),
  });
};

const providerRanking: ToolHandler = async (raw) => {
  const input = parseInput(raw);
  const marketplaceUrl = (input.marketplaceUrl || marketplaceUrlFromEnv()).replace(/\/$/, '');
  const limit = Math.max(1, Math.min(100, toNumber(input.limit, 25)));
  const sortBy = (input.sortBy || 'score').toString();
  const category = typeof input.category === 'string' ? input.category : '';

  const query = new URLSearchParams({
    format: 'full',
    limit: String(Math.max(200, limit)),
  });
  if (category) query.set('category', category);

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?${query.toString()}`);
  const providers = normalizeProviders(data).filter(p => p.isOnline !== false);

  const sorters: Record<string, (a: any, b: any) => number> = {
    score: (a, b) => toNumber(b.score, 0) - toNumber(a.score, 0),
    quality: (a, b) => toNumber(b.qualityScore, 0) - toNumber(a.qualityScore, 0),
    latency: (a, b) => toNumber(a.avgResponseTime, 1e9) - toNumber(b.avgResponseTime, 1e9),
    models: (a, b) => toNumber(b.models?.length, 0) - toNumber(a.models?.length, 0),
  };
  const sorter = sorters[sortBy] || sorters.score;

  const ranked = [...providers].sort(sorter).slice(0, limit).map((p: any, idx: number) => ({
    rank: idx + 1,
    ...compactProvider(p),
    qualityScore: p.qualityScore ?? 0,
    avgResponseTime: p.avgResponseTime ?? null,
    modelCount: Array.isArray(p.models) ? p.models.length : 0,
  }));

  return JSON.stringify({
    marketplaceUrl,
    sortBy: sortBy in sorters ? sortBy : 'score',
    category: category || null,
    count: ranked.length,
    ranked,
  });
};

function buildRoutePlan(goal: string, providers: any[]): any {
  const g = goal.toLowerCase();
  const recommendations: any[] = [];

  const pickByName = (name: string) =>
    providers.find(p => String(p.name || '').toLowerCase() === name.toLowerCase());

  const pickByContains = (term: string) =>
    providers.find(p => String(p.name || '').toLowerCase().includes(term.toLowerCase()));

  if (g.includes('search') || g.includes('crawl') || g.includes('web')) {
    const desearch = pickByName('HS58-Desearch') || pickByContains('desearch');
    if (desearch) recommendations.push({ step: 'search', provider: compactProvider(desearch) });
  }

  if (g.includes('predict') || g.includes('forecast')) {
    const numinous = pickByContains('numinous');
    if (numinous) recommendations.push({ step: 'forecast', provider: compactProvider(numinous) });
  }

  if (g.includes('code') || g.includes('execute')) {
    const e2b = pickByName('HS58-E2B') || pickByContains('e2b');
    if (e2b) recommendations.push({ step: 'execute', provider: compactProvider(e2b) });
  }

  if (g.includes('analytics') || g.includes('tao') || g.includes('subnet') || g.includes('validator')) {
    const taostats = pickByName('HS58-Taostats') || pickByContains('taostats');
    if (taostats) recommendations.push({ step: 'analyze', provider: compactProvider(taostats) });
  }

  if (recommendations.length === 0) {
    const top = [...providers]
      .filter(p => p.isOnline !== false)
      .sort((a, b) => toNumber(b.score, 0) - toNumber(a.score, 0))
      .slice(0, 3)
      .map(compactProvider);
    return {
      strategy: 'fallback_top_score',
      recommendations: top.map((p, i) => ({ step: `step_${i + 1}`, provider: p })),
      note: 'No strong keyword match. Returning top scored online providers.',
    };
  }

  return {
    strategy: 'keyword_matched_route',
    recommendations,
    note: 'Keyword-based route plan. Validate provider docs before execution.',
  };
}

const routePlan: ToolHandler = async (raw) => {
  const input = parseInput(raw);
  const marketplaceUrl = (input.marketplaceUrl || marketplaceUrlFromEnv()).replace(/\/$/, '');
  const goal = (input.goal || input.intent || '').toString().trim();
  if (!goal) return JSON.stringify({ error: 'goal is required' });

  const data = await fetchJson(`${marketplaceUrl}/api/mcp/providers?format=full&limit=200`);
  const providers = normalizeProviders(data);
  const plan = buildRoutePlan(goal, providers);

  return JSON.stringify({
    goal,
    marketplaceUrl,
    providerCount: providers.length,
    ...plan,
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['observability/provider-status', providerStatus],
  ['observability/provider-ranking', providerRanking],
  ['observability/route-plan', routePlan],
]);
