import type {
  ArbitragePlannerInput,
  ConversionTrackerInput,
  GigPosting,
  GigScannerInput,
  ProposalDrafterInput,
  ToolHandler,
} from './types.js';

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

function rankGigs(input: GigScannerInput) {
  const gigs = cleanGigs(input);
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

const gigScanner: ToolHandler = async (raw) => {
  const input = parseInput<GigScannerInput>(raw);
  const ranked = rankGigs(input);
  const target = Math.max(100, toNumber(input.target_daily_income_usd, 1000));
  const top = ranked.slice(0, 10);

  return JSON.stringify({
    model: 'gigarb/gig-scanner',
    scan_id: `ga_${Date.now()}`,
    niche: String(input.niche || 'general'),
    target_daily_income_usd: Number(target.toFixed(2)),
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
  const ranked = rankGigs(input);
  const gig = input.selected_gig_title
    ? ranked.find((g) => g.title === input.selected_gig_title)
    : ranked[0];
  const highlights = Array.isArray(input.portfolio_highlights) ? input.portfolio_highlights.slice(0, 4) : [];
  const valueProp = highlights.length ? highlights.join('; ') : 'fast turnaround, clear communication, measurable outcomes';

  return JSON.stringify({
    model: 'gigarb/proposal-drafter',
    draft_id: `gpd_${Date.now()}`,
    selected_gig: gig?.title ?? null,
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
    funnel: { sent, shortlisted, won, lost },
    conversion_rate_pct: conversion,
    close_signal_pct: closeRate,
    revenue_won_usd: wonValue,
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
  const ranked = rankGigs(input);
  const top = ranked.slice(0, 6);
  const hoursPerDay = clamp(toNumber(input.available_hours_per_day, 6), 1, 18);
  const team = Math.max(1, toInteger(input.team_capacity, 1));
  const capacityHours = hoursPerDay * team;
  const selected = top.filter((g) => (g.estimated_hours || 0) <= capacityHours).slice(0, 4);
  const projectedDaily = Number(selected.reduce((sum, g) => sum + g.expected_value_usd, 0).toFixed(2));

  return JSON.stringify({
    model: 'gigarb/arbitrage-planner',
    planner_id: `gap_${Date.now()}`,
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
