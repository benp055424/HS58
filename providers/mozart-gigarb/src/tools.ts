import type {
  ArbitragePlannerInput,
  ConversionTrackerInput,
  GigPlatform,
  GigPosting,
  GigScannerInput,
  ProposalDrafterInput,
  ToolHandler,
} from './types.js';

type IngestionMode = 'provided' | 'live' | 'fallback';

interface IngestionInfo {
  mode: IngestionMode;
  sources: string[];
  fetched_at: string;
  gig_count: number;
  note?: string;
}

const FALLBACK_GIGS: GigPosting[] = [
  {
    platform: 'upwork',
    title: 'Build conversion-focused landing page for SaaS',
    category: 'web-development',
    budget_usd: 1200,
    estimated_hours: 16,
    urgency: 'high',
    client_rating: 4.9,
    proposal_count: 14,
  },
  {
    platform: 'upwork',
    title: 'Set up outbound lead generation workflow with automation',
    category: 'growth-ops',
    budget_usd: 900,
    estimated_hours: 12,
    urgency: 'medium',
    client_rating: 4.7,
    proposal_count: 11,
  },
  {
    platform: 'upwork',
    title: 'SEO content cluster and affiliate funnel implementation',
    category: 'content-marketing',
    budget_usd: 1500,
    estimated_hours: 24,
    urgency: 'medium',
    client_rating: 4.8,
    proposal_count: 9,
  },
  {
    platform: 'upwork',
    title: 'Python data scraper + reporting dashboard',
    category: 'automation',
    budget_usd: 800,
    estimated_hours: 10,
    urgency: 'high',
    client_rating: 4.6,
    proposal_count: 18,
  },
  {
    platform: 'upwork',
    title: 'AI chatbot integration and support workflow',
    category: 'ai-integration',
    budget_usd: 1100,
    estimated_hours: 14,
    urgency: 'medium',
    client_rating: 4.8,
    proposal_count: 16,
  },
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

function toInteger(value: unknown, fallback = 0): number {
  return Math.floor(toNumber(value, fallback));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  return clamp(toNumber(process.env[name], fallback), min, max);
}

function normalizePlatform(platform: unknown): GigPlatform {
  const p = String(platform || '').toLowerCase();
  if (p === 'upwork' || p === 'fiverr' || p === 'contra') return p;
  return 'other';
}

function normalizeUrgency(value: unknown): 'low' | 'medium' | 'high' {
  const v = String(value || '').toLowerCase();
  if (v === 'low' || v === 'high') return v;
  return 'medium';
}

function platformWeight(platform: GigPlatform | undefined): number {
  if (platform === 'upwork') return 6;
  if (platform === 'contra') return 4;
  if (platform === 'fiverr') return 2;
  return 0;
}

function stripTags(text: string): string {
  return text
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`upstream_http_${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseRssItems(xml: string): Array<{ title: string; description: string }> {
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  return items.map((item) => {
    const title = stripTags((item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || '').trim());
    const description = stripTags((item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || '').trim());
    return { title, description };
  });
}

function estimateBudget(description: string): number {
  const fixed = description.match(/Budget:\s*\$([\d,]+)/i);
  if (fixed) return Math.max(100, toNumber(fixed[1].replace(/,/g, ''), 0));
  const hourlyRange = description.match(/Hourly Range:\s*\$([\d.]+)\s*-\s*\$([\d.]+)/i);
  if (hourlyRange) {
    const lo = toNumber(hourlyRange[1], 0);
    const hi = toNumber(hourlyRange[2], lo);
    return Number((((lo + hi) / 2) * 12).toFixed(2));
  }
  return 600;
}

function estimateHours(description: string): number {
  const duration = description.match(/Duration:\s*([^|]+)/i)?.[1] || '';
  if (/more than 6 months/i.test(duration)) return 40;
  if (/3 to 6 months/i.test(duration)) return 28;
  if (/1 to 3 months/i.test(duration)) return 20;
  if (/Less than 1 month/i.test(duration)) return 12;
  return 14;
}

function estimateProposals(description: string): number {
  const proposals = description.match(/Proposals:\s*([^|]+)/i)?.[1] || '';
  if (/Less than 5/i.test(proposals)) return 4;
  if (/5 to 10/i.test(proposals)) return 8;
  if (/10 to 15/i.test(proposals)) return 12;
  if (/15 to 20/i.test(proposals)) return 17;
  if (/20 to 50/i.test(proposals)) return 28;
  if (/50\+/i.test(proposals)) return 60;
  return 10;
}

function estimateUrgency(title: string, description: string): 'low' | 'medium' | 'high' {
  const hay = `${title} ${description}`.toLowerCase();
  if (hay.includes('urgent') || hay.includes('asap') || hay.includes('immediately')) return 'high';
  if (hay.includes('long-term') || hay.includes('ongoing')) return 'low';
  return 'medium';
}

async function fetchUpworkRssGigs(niche: string, limit: number, timeoutMs: number): Promise<GigPosting[]> {
  const query = encodeURIComponent(niche || 'automation');
  const url = `https://www.upwork.com/ab/feed/jobs/rss?q=${query}&sort=recency`;
  const xml = await fetchText(url, timeoutMs);
  const items = parseRssItems(xml);
  return items
    .map(({ title, description }) => ({
      platform: 'upwork' as const,
      title: title || 'Upwork listing',
      category: niche || 'general',
      budget_usd: estimateBudget(description),
      estimated_hours: estimateHours(description),
      urgency: estimateUrgency(title, description),
      client_rating: 4.6,
      proposal_count: estimateProposals(description),
    }))
    .slice(0, limit);
}

function cleanGigs(input: GigScannerInput): GigPosting[] {
  if (!Array.isArray(input.gigs)) return [];
  return input.gigs.map((g) => ({
    platform: normalizePlatform(g.platform),
    title: String(g.title || 'Untitled gig'),
    category: String(g.category || 'general'),
    budget_usd: Math.max(0, toNumber(g.budget_usd, 0)),
    estimated_hours: Math.max(1, toNumber(g.estimated_hours, 8)),
    urgency: normalizeUrgency(g.urgency),
    client_rating: clamp(toNumber(g.client_rating, 4.5), 0, 5),
    proposal_count: Math.max(0, toInteger(g.proposal_count, 0)),
  }));
}

function fallbackGigs(niche: string, limit: number): GigPosting[] {
  return FALLBACK_GIGS.slice(0, limit).map((g) => ({
    ...g,
    category: niche || g.category || 'general',
    title: niche ? `${g.title} (${niche})` : g.title,
  }));
}

async function resolveGigs(input: GigScannerInput): Promise<{ gigs: GigPosting[]; ingestion: IngestionInfo }> {
  const provided = cleanGigs(input);
  if (provided.length > 0) {
    return {
      gigs: provided,
      ingestion: {
        mode: 'provided',
        sources: ['caller.gigs'],
        fetched_at: new Date().toISOString(),
        gig_count: provided.length,
      },
    };
  }

  const niche = String(input.niche || 'automation');
  const limit = envNumber('UPWORK_RSS_LIMIT', 10, 3, 30);
  const timeoutMs = envNumber('UPWORK_RSS_TIMEOUT_MS', 7000, 1500, 20000);
  try {
    const live = await fetchUpworkRssGigs(niche, limit, timeoutMs);
    if (live.length > 0) {
      return {
        gigs: live,
        ingestion: {
          mode: 'live',
          sources: ['upwork.rss'],
          fetched_at: new Date().toISOString(),
          gig_count: live.length,
        },
      };
    }
  } catch (error: any) {
    const fallback = fallbackGigs(niche, limit);
    return {
      gigs: fallback,
      ingestion: {
        mode: 'fallback',
        sources: ['static.gig.fallback'],
        fetched_at: new Date().toISOString(),
        gig_count: fallback.length,
        note: `live_fetch_failed:${String(error?.message || 'unknown').slice(0, 80)}`,
      },
    };
  }

  const fallback = fallbackGigs(niche, limit);
  return {
    gigs: fallback,
    ingestion: {
      mode: 'fallback',
      sources: ['static.gig.fallback'],
      fetched_at: new Date().toISOString(),
      gig_count: fallback.length,
      note: 'live_fetch_returned_empty',
    },
  };
}

function scoreGig(gig: GigPosting): number {
  const budget = Math.max(0, toNumber(gig.budget_usd, 0));
  const hours = Math.max(1, toNumber(gig.estimated_hours, 8));
  const urgency = normalizeUrgency(gig.urgency);
  const rating = clamp(toNumber(gig.client_rating, 4.5), 0, 5);
  const proposals = Math.max(0, toNumber(gig.proposal_count, 0));
  const valueDensity = budget / hours;
  const urgencyBoost = urgency === 'high' ? 14 : urgency === 'low' ? -4 : 6;
  const ratingBoost = rating >= 4.7 ? 10 : rating >= 4.0 ? 5 : 0;
  const platformBoost = platformWeight(gig.platform);
  const competitionPenalty = Math.min(25, proposals * 0.9);
  const score = valueDensity * 1.25 + urgencyBoost + ratingBoost + platformBoost - competitionPenalty;
  return Number(clamp(score, 0, 100).toFixed(2));
}

function rankFromGigs(gigs: GigPosting[]) {
  const ranked = gigs
    .map((gig) => {
      const score = scoreGig(gig);
      const winProb = Number(clamp((100 - (gig.proposal_count || 0)) / 100 + score / 220, 0.05, 0.92).toFixed(4));
      const expectedValue = Number(((gig.budget_usd || 0) * winProb).toFixed(2));
      return {
        ...gig,
        score,
        estimated_win_probability: winProb,
        expected_value_usd: expectedValue,
      };
    })
    .sort((a, b) => b.score - a.score);
  return ranked;
}

async function rankGigs(input: GigScannerInput) {
  const { gigs, ingestion } = await resolveGigs(input);
  return { ranked: rankFromGigs(gigs), ingestion };
}

const gigScanner: ToolHandler = async (raw) => {
  const input = parseInput<GigScannerInput>(raw);
  const { ranked, ingestion } = await rankGigs(input);
  const target = Math.max(100, toNumber(input.target_daily_income_usd, 1000));
  const top = ranked.slice(0, 10);

  return JSON.stringify({
    model: 'gigarb/gig-scanner',
    scan_id: `ga_${Date.now()}`,
    niche: String(input.niche || 'general'),
    target_daily_income_usd: Number(target.toFixed(2)),
    ingestion,
    ranked_gigs: top,
    pipeline_summary: {
      gigs_scanned: ranked.length,
      expected_topline_usd: Number(top.reduce((sum, g) => sum + g.expected_value_usd, 0).toFixed(2)),
      recommended_daily_proposals: Math.max(3, Math.ceil(target / 250)),
    },
    generatedAt: new Date().toISOString(),
  });
};

const proposalDrafter: ToolHandler = async (raw) => {
  const input = parseInput<ProposalDrafterInput>(raw);
  const { ranked, ingestion } = await rankGigs(input);
  const gig = input.selected_gig_title
    ? ranked.find((g) => g.title === input.selected_gig_title)
    : ranked[0];
  const highlights = Array.isArray(input.portfolio_highlights) ? input.portfolio_highlights.slice(0, 4) : [];
  const valueProp = highlights.length ? highlights.join('; ') : 'fast turnaround, clear communication, measurable outcomes';

  return JSON.stringify({
    model: 'gigarb/proposal-drafter',
    draft_id: `gpd_${Date.now()}`,
    selected_gig: gig?.title ?? null,
    ingestion,
    proposal_outline: {
      opener: `I can deliver "${gig?.title || 'your project'}" with a scoped plan in the first 24 hours.`,
      credibility: `Relevant proof: ${valueProp}.`,
      execution_plan: [
        'Kickoff and requirements lock within 2 hours',
        'First deliverable draft within 24 hours',
        'One revision loop with acceptance criteria',
      ],
      close: 'If useful, I can start immediately and share milestone updates daily.',
    },
    pricing_guidance: {
      suggested_bid_usd: Number(((gig?.budget_usd || 200) * 0.92).toFixed(2)),
      floor_bid_usd: Number(((gig?.budget_usd || 200) * 0.75).toFixed(2)),
    },
    generatedAt: new Date().toISOString(),
  });
};

const conversionTracker: ToolHandler = async (raw) => {
  const input = parseInput<ConversionTrackerInput>(raw);
  const { ranked, ingestion } = await rankGigs(input);
  const proposals = Array.isArray(input.proposals_sent) ? input.proposals_sent : [];
  const sent = proposals.filter((p) => p.status === 'sent').length;
  const shortlisted = proposals.filter((p) => p.status === 'shortlisted').length;
  const won = proposals.filter((p) => p.status === 'won').length;
  const lost = proposals.filter((p) => p.status === 'lost').length;
  const total = Math.max(1, proposals.length);
  const conversion = Number(((won / total) * 100).toFixed(2));
  const closeRate = Number((((won + shortlisted) / total) * 100).toFixed(2));
  const wonValue = Number(proposals.reduce((sum, p) => sum + Math.max(0, toNumber(p.value_usd, 0)), 0).toFixed(2));

  return JSON.stringify({
    model: 'gigarb/conversion-tracker',
    tracker_id: `gct_${Date.now()}`,
    ingestion,
    funnel: { sent, shortlisted, won, lost },
    conversion_rate_pct: conversion,
    close_signal_pct: closeRate,
    revenue_won_usd: wonValue,
    market_context: ranked.slice(0, 3).map((g) => ({
      title: g.title,
      expected_value_usd: g.expected_value_usd,
      score: g.score,
    })),
    recommendations: [
      'raise proposal quality for high-budget gigs only',
      'follow up shortlisted opportunities within 12 hours',
      'drop categories with <5% win-rate after 20 proposals',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const arbitragePlanner: ToolHandler = async (raw) => {
  const input = parseInput<ArbitragePlannerInput>(raw);
  const { ranked, ingestion } = await rankGigs(input);
  const top = ranked.slice(0, 6);
  const hoursPerDay = clamp(toNumber(input.available_hours_per_day, 6), 1, 18);
  const team = Math.max(1, toInteger(input.team_capacity, 1));
  const capacityHours = hoursPerDay * team;
  const selected = top.filter((g) => (g.estimated_hours || 0) <= capacityHours).slice(0, 4);
  const projectedDaily = Number(selected.reduce((sum, g) => sum + g.expected_value_usd, 0).toFixed(2));

  return JSON.stringify({
    model: 'gigarb/arbitrage-planner',
    planner_id: `gap_${Date.now()}`,
    ingestion,
    capacity: {
      available_hours_per_day: Number(hoursPerDay.toFixed(2)),
      team_capacity: team,
      effective_capacity_hours: Number(capacityHours.toFixed(2)),
    },
    selected_gigs: selected.map((g, idx) => ({
      rank: idx + 1,
      title: g.title,
      platform: g.platform,
      expected_value_usd: g.expected_value_usd,
      estimated_hours: g.estimated_hours,
      priority_reason: 'high score and favorable competition density',
    })),
    projected_daily_income_usd: projectedDaily,
    operating_rules: [
      'allocate first 40% capacity to highest expected value gigs',
      'reserve 20% capacity for revisions and client communication',
      're-rank gig pool every 24 hours',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['gigarb/gig-scanner', gigScanner],
  ['gigarb/proposal-drafter', proposalDrafter],
  ['gigarb/conversion-tracker', conversionTracker],
  ['gigarb/arbitrage-planner', arbitragePlanner],
]);
