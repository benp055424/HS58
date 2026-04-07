import type {
  AffiliateMapperInput,
  ContentTopicInput,
  MonetizedResearchInput,
  PublishingTargetsInput,
  SeoArticleInput,
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

function normalizeIntent(intent: unknown): 'low' | 'medium' | 'high' {
  const v = String(intent || '').toLowerCase();
  if (v === 'low' || v === 'high') return v;
  return 'medium';
}

function normalizeTopic(input: ContentTopicInput): Required<ContentTopicInput> {
  return {
    topic: String(input.topic || 'Untapped income topic'),
    audience: String(input.audience || 'solo builders'),
    buyer_intent: normalizeIntent(input.buyer_intent),
    region: String(input.region || 'global'),
  };
}

const monetizedResearch: ToolHandler = async (raw) => {
  const input = parseInput<MonetizedResearchInput>(raw);
  const base = normalizeTopic(input);
  const notes = Array.isArray(input.source_notes) ? input.source_notes.slice(0, 12) : [];
  const seeds = Array.isArray(input.keyword_seed) && input.keyword_seed.length
    ? input.keyword_seed.slice(0, 8)
    : [
        `${base.topic} tools`,
        `${base.topic} best software`,
        `${base.topic} pricing`,
        `${base.topic} alternatives`,
      ];
  const intentMultiplier = base.buyer_intent === 'high' ? 1.25 : base.buyer_intent === 'low' ? 0.85 : 1;

  const opportunities = seeds.map((kw, idx) => {
    const difficulty = clamp(28 + kw.length + idx * 4, 15, 85);
    const cpc = Number((0.45 + (kw.length % 7) * 0.21).toFixed(2));
    const demand = clamp(40 + (idx * 8) + (base.buyer_intent === 'high' ? 12 : 0), 25, 95);
    const score = Number(clamp((demand * intentMultiplier) - (difficulty * 0.45) + cpc * 8, 5, 99).toFixed(2));
    return {
      keyword: kw,
      demand_score: demand,
      difficulty_score: difficulty,
      cpc_usd_estimate: cpc,
      monetization_score: score,
    };
  }).sort((a, b) => b.monetization_score - a.monetization_score);

  return JSON.stringify({
    model: 'contentmint/monetized-research',
    research_id: `cmr_${Date.now()}`,
    topic: base.topic,
    audience: base.audience,
    region: base.region,
    opportunity_keywords: opportunities,
    source_notes_count: notes.length,
    generatedAt: new Date().toISOString(),
  });
};

const seoArticle: ToolHandler = async (raw) => {
  const input = parseInput<SeoArticleInput>(raw);
  const base = normalizeTopic(input);
  const goal = Math.max(100, toNumber(input.monetization_goal_usd_monthly, 1000));
  const angle = String(input.angle || `How ${base.audience} can monetize ${base.topic} in ${base.region}`);
  const h2 = [
    `Why ${base.topic} demand exists now`,
    `How to choose tools with affiliate upside`,
    `Step-by-step setup for first revenue`,
    `Conversion tips that increase buyer trust`,
    `30-day execution checklist`,
  ];
  const cta = base.buyer_intent === 'high'
    ? 'Compare top tools now and start your first monetized workflow today.'
    : 'Start with one tool trial, publish results, and iterate weekly.';

  return JSON.stringify({
    model: 'contentmint/seo-article',
    article_id: `cma_${Date.now()}`,
    title: `${base.topic}: Practical Monetization Guide for ${base.audience}`,
    angle,
    seo_outline: {
      h1: `${base.topic} monetization blueprint`,
      h2,
      faq: [
        `How long until ${base.topic} content earns revenue?`,
        'What affiliate payout model converts best?',
        'How many posts are needed for first meaningful income?',
      ],
    },
    monetization_plan: {
      monthly_goal_usd: Number(goal.toFixed(2)),
      target_clicks_per_month: Math.ceil(goal / 2.4),
      target_conversion_rate_pct: Number((base.buyer_intent === 'high' ? 2.8 : 1.9).toFixed(2)),
      primary_cta: cta,
    },
    generatedAt: new Date().toISOString(),
  });
};

const affiliateMapper: ToolHandler = async (raw) => {
  const input = parseInput<AffiliateMapperInput>(raw);
  const base = normalizeTopic(input);
  const candidates = Array.isArray(input.candidate_programs) ? input.candidate_programs : [];
  const normalized = candidates.map((p) => {
    const payout = Math.max(0, toNumber(p.payout_usd, 0));
    const conversion = clamp(toNumber(p.conversion_rate_pct, 1), 0.1, 25);
    const difficulty = String(p.approval_difficulty || 'medium');
    const difficultyPenalty = difficulty === 'hard' ? 12 : difficulty === 'easy' ? 0 : 6;
    const score = Number(clamp((payout * 1.4) + (conversion * 9) - difficultyPenalty, 1, 99).toFixed(2));
    return {
      name: String(p.name || 'unknown-program'),
      payout_usd: Number(payout.toFixed(2)),
      conversion_rate_pct: Number(conversion.toFixed(2)),
      approval_difficulty: difficulty,
      affiliate_score: score,
    };
  }).sort((a, b) => b.affiliate_score - a.affiliate_score);

  const fallback = normalized.length
    ? normalized
    : [
        {
          name: `${base.topic} software partner`,
          payout_usd: 45,
          conversion_rate_pct: 2.2,
          approval_difficulty: 'medium',
          affiliate_score: 63,
        },
        {
          name: `${base.topic} course marketplace`,
          payout_usd: 28,
          conversion_rate_pct: 3.4,
          approval_difficulty: 'easy',
          affiliate_score: 69,
        },
      ];

  return JSON.stringify({
    model: 'contentmint/affiliate-mapper',
    map_id: `cmf_${Date.now()}`,
    topic: base.topic,
    top_programs: fallback.slice(0, 6),
    integration_plan: [
      'place primary comparison table above first fold',
      'add 2 contextual in-article CTA blocks',
      'use proof snippets and mini case studies near CTA',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const publishingTargets: ToolHandler = async (raw) => {
  const input = parseInput<PublishingTargetsInput>(raw);
  const base = normalizeTopic(input);
  const topicSlug = base.topic.toLowerCase().replace(/\s+/g, '-');
  const count = clamp(toInteger(input.publication_count, 5), 1, 15);
  const assets = Array.isArray(input.existing_assets) ? input.existing_assets : [];
  const targets = Array.from({ length: count }).map((_, idx) => {
    const authority = clamp(45 + idx * 5, 30, 95);
    const referral = clamp(500 + idx * 220, 200, 10000);
    return {
      publication: `${topicSlug}-target-${idx + 1}`,
      format: idx % 2 === 0 ? 'guest_post' : 'roundup_pitch',
      authority_score: authority,
      est_monthly_referral_clicks: referral,
      pitch_angle: `${base.audience} playbook for ${base.topic} monetization`,
    };
  });

  return JSON.stringify({
    model: 'contentmint/publishing-targets',
    targets_id: `cmp_${Date.now()}`,
    topic: base.topic,
    assets_available: assets.length,
    publishing_targets: targets,
    rollout_sequence: [
      'publish owned article first',
      'launch 2 high-fit guest placements',
      'syndicate condensed insight threads with CTA',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['contentmint/monetized-research', monetizedResearch],
  ['contentmint/seo-article', seoArticle],
  ['contentmint/affiliate-mapper', affiliateMapper],
  ['contentmint/publishing-targets', publishingTargets],
]);
