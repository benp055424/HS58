import type { HubRouteResponse, HubRecommendation, QueryRequest } from './types.js';

type RouteBlueprint = {
  key: string;
  subnet?: number;
  provider: string;
  model: string;
  purpose: string;
  keywords: string[];
  notes: string[];
  followups: QueryRequest[];
  exampleInput?: Record<string, unknown>;
};

const ROUTES: RouteBlueprint[] = [
  {
    key: 'sn13_data_universe',
    subnet: 13,
    provider: 'macrocosmos-sn13',
    model: 'sn13/social-data',
    purpose: 'Fresh social scraping and desirability-driven data tasks',
    keywords: ['sn13', 'social', 'reddit', 'x', 'twitter', 'youtube', 'scrape', 'desirability'],
    notes: [
      'Use when the goal is fresh social data collection.',
      'Pair with SN58 providers for agent-facing distribution.',
    ],
    followups: [
      { endpoint: 'subnet/latest', params: { netuid: 13, limit: 1 } },
      { endpoint: 'subnet/emission', params: { netuid: 13, limit: 7 } },
    ],
    exampleInput: {
      source: 'x',
      keywords: ['bittensor', 'tao'],
      limit: 50,
    },
  },
  {
    key: 'sn58_handshake_marketplace',
    subnet: 58,
    provider: 'handshake58-directory',
    model: 'provider-selection',
    purpose: 'Discover and route to high-uptime providers with DRAIN channels',
    keywords: ['sn58', 'handshake', 'provider', 'marketplace', 'drain', 'uptime', 'agent'],
    notes: [
      'Use for multi-provider discovery and paid execution.',
      'Filter by category/model/score for best reliability.',
    ],
    followups: [
      { endpoint: 'subnet/latest', params: { netuid: 58, limit: 1 } },
      { endpoint: 'subnet/emission', params: { netuid: 58, limit: 7 } },
      { endpoint: 'validator/metrics/latest', params: { netuid: 58, limit: 10 } },
    ],
  },
  {
    key: 'sn22_search',
    subnet: 22,
    provider: 'hs58-desearch',
    model: 'desearch/search',
    purpose: 'Search, crawling, and SERP-intelligence workflows',
    keywords: ['sn22', 'search', 'crawl', 'serp', 'web'],
    notes: [
      'Use for broad web retrieval and search-first workflows.',
    ],
    followups: [
      { endpoint: 'subnet/latest', params: { netuid: 22, limit: 1 } },
      { endpoint: 'subnet/emission', params: { netuid: 22, limit: 7 } },
    ],
  },
  {
    key: 'taostats_analytics',
    provider: 'community-taostats',
    model: 'taostats/query',
    purpose: 'On-demand analytics: emissions, metagraph, stake, validator/miner metrics',
    keywords: ['taostats', 'analytics', 'emission', 'metagraph', 'validator', 'miner', 'stake'],
    notes: [
      'Use for network intelligence and decision support.',
    ],
    followups: [
      { endpoint: 'subnet/latest', params: { limit: 20 } },
      { endpoint: 'subnet/emission', params: { limit: 20 } },
      { endpoint: 'tao_emission', params: { limit: 20 } },
    ],
  },
];

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function rankRoutes(goal: string, preferredSubnets: number[]): RouteBlueprint[] {
  const tokens = tokenize(goal);
  const preferred = new Set(preferredSubnets);

  const scored = ROUTES.map(route => {
    let score = 0;
    for (const token of tokens) {
      if (route.keywords.some(k => k.includes(token))) score += 2;
      if (route.purpose.toLowerCase().includes(token)) score += 1;
    }
    if (route.subnet && preferred.has(route.subnet)) score += 3;
    return { route, score };
  });

  return scored.sort((a, b) => b.score - a.score).map(x => x.route);
}

export function resolveHubIntent(
  goalRaw: string,
  constraints: Record<string, string | number | boolean> = {},
  preferredSubnets: number[] = []
): HubRouteResponse {
  const goal = goalRaw.trim() || 'route my Bittensor task';
  const ranked = rankRoutes(goal, preferredSubnets);
  const top = ranked.slice(0, 3);
  const primary = top[0];

  const recommendations: HubRecommendation[] = top.map(route => ({
    provider: route.provider,
    model: route.model,
    purpose: route.purpose,
    subnet: route.subnet,
    exampleInput: route.exampleInput,
  }));

  const taostatsFollowups = top.flatMap(r => r.followups).slice(0, 6);
  const notes = [
    `Constraints received: ${JSON.stringify(constraints)}`,
    ...new Set(top.flatMap(r => r.notes)),
    'Validate live provider availability before final routing.',
  ];

  return {
    goal,
    matchedIntent: primary?.key ?? 'taostats_analytics',
    strategy: `Prioritize ${primary?.provider ?? 'community-taostats'} then branch by reliability and model fit.`,
    recommendations,
    taostatsFollowups,
    notes,
  };
}
