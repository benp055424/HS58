import type {
  EarnpathIncomeMapInput,
  EarnpathRiskCheckInput,
  EarnpathWeeklyPlanInput,
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

function normalizeRole(role: unknown): 'miner' | 'validator' | 'provider' | 'allocator' | 'operator' {
  const r = String(role || '').toLowerCase();
  if (r === 'validator' || r === 'provider' || r === 'allocator' || r === 'operator') return r;
  return 'miner';
}

function normalizeRisk(risk: unknown): 'low' | 'medium' | 'high' {
  const r = String(risk || '').toLowerCase();
  if (r === 'low' || r === 'high') return r;
  return 'medium';
}

function normalizeExperience(exp: unknown): 'beginner' | 'intermediate' | 'advanced' {
  const v = String(exp || '').toLowerCase();
  if (v === 'beginner' || v === 'advanced') return v;
  return 'intermediate';
}

function range(min: number, max: number): { min: number; max: number } {
  return { min: Number(min.toFixed(2)), max: Number(max.toFixed(2)) };
}

function laneCatalog(role: string) {
  const defaultLanes = [
    { lane: 'provider-ops-services', baseMonthly: 180, velocityDays: 10, difficulty: 0.45 },
    { lane: 'delegation-growth-services', baseMonthly: 140, velocityDays: 12, difficulty: 0.5 },
    { lane: 'subnet-automation-consulting', baseMonthly: 240, velocityDays: 15, difficulty: 0.6 },
  ];
  if (role === 'validator') {
    return [
      { lane: 'validator-performance-optimization', baseMonthly: 260, velocityDays: 14, difficulty: 0.62 },
      { lane: 'delegation-attraction-campaigns', baseMonthly: 190, velocityDays: 11, difficulty: 0.55 },
      { lane: 'governance-and-ops-advisory', baseMonthly: 150, velocityDays: 10, difficulty: 0.48 },
    ];
  }
  if (role === 'provider') {
    return [
      { lane: 'agent-provider-productization', baseMonthly: 220, velocityDays: 9, difficulty: 0.42 },
      { lane: 'marketplace-growth-ops', baseMonthly: 170, velocityDays: 8, difficulty: 0.38 },
      { lane: 'workflow-automation-services', baseMonthly: 260, velocityDays: 12, difficulty: 0.55 },
    ];
  }
  return defaultLanes;
}

function confidenceFor(risk: string, exp: string, hoursPerWeek: number): number {
  const riskFactor = risk === 'low' ? 0.82 : risk === 'high' ? 0.73 : 0.78;
  const expFactor = exp === 'advanced' ? 1.08 : exp === 'beginner' ? 0.86 : 1.0;
  const timeFactor = clamp(hoursPerWeek / 20, 0.55, 1.15);
  return Number(clamp(riskFactor * expFactor * timeFactor, 0.3, 0.96).toFixed(4));
}

function scoreAction(action: any): number {
  const automation = action?.automation_level === 'high' ? 1 : action?.automation_level === 'medium' ? 0.65 : 0.35;
  const capital = clamp(toNumber(action?.capital_required_usd, 0), 0, 5000);
  const complexity = clamp(toNumber(action?.complexity_score, 0.5), 0, 1);
  const score = (automation * 40) + ((1 - complexity) * 35) + (Math.max(0, 1 - capital / 5000) * 25);
  return Number(score.toFixed(2));
}

const incomeMap: ToolHandler = async (raw) => {
  const input = parseInput<EarnpathIncomeMapInput>(raw);
  const role = normalizeRole(input?.profile?.role);
  const exp = normalizeExperience(input?.profile?.experience_level);
  const risk = normalizeRisk(input?.profile?.risk_tolerance);
  const hoursPerWeek = clamp(toInteger(input?.profile?.hours_per_week, 12), 1, 80);
  const capitalUsd = Math.max(0, toNumber(input?.profile?.capital_usd, 0));
  const monthlyGoalUsd = Math.max(0, toNumber(input?.targets?.monthly_income_goal_usd, 500));
  const timeHorizonDays = clamp(toInteger(input?.targets?.time_horizon_days, 90), 7, 365);

  const lanes = laneCatalog(role).map((lane, idx) => {
    const timeFactor = clamp(hoursPerWeek / 20, 0.5, 1.4);
    const capitalFactor = clamp(1 + Math.min(capitalUsd, 2000) / 8000, 0.8, 1.25);
    const riskFactor = risk === 'high' ? 1.12 : risk === 'low' ? 0.88 : 1.0;
    const expFactor = exp === 'advanced' ? 1.15 : exp === 'beginner' ? 0.8 : 1.0;
    const minEstimate = lane.baseMonthly * timeFactor * riskFactor * expFactor * 0.65;
    const maxEstimate = lane.baseMonthly * timeFactor * capitalFactor * riskFactor * expFactor * 1.3;
    const ttf = Math.max(3, Math.round(lane.velocityDays * (exp === 'beginner' ? 1.2 : 1.0)));
    return {
      lane: lane.lane,
      expected_monthly_range_usd: range(minEstimate, maxEstimate),
      time_to_first_revenue_days: ttf,
      dependencies: [
        'wallet + signing setup',
        'provider/service deployment',
        'proof and reporting cadence',
      ],
      key_risks: [
        'demand volatility in early-stage subnet',
        'pricing mismatch vs value',
        'execution drift without weekly review',
      ],
      fit_score: Number((0.75 - lane.difficulty + (idx === 0 ? 0.08 : 0)).toFixed(4)),
    };
  });

  lanes.sort((a, b) => b.fit_score - a.fit_score);
  const primary = lanes[0]?.lane || 'provider-ops-services';
  const confidence = confidenceFor(risk, exp, hoursPerWeek);

  return JSON.stringify({
    model: 'earnpath/income-map',
    strategy_id: `ep_${Date.now()}`,
    profile: { role, experience_level: exp, risk_tolerance: risk, hours_per_week: hoursPerWeek, capital_usd: capitalUsd },
    targets: { monthly_income_goal_usd: monthlyGoalUsd, time_horizon_days: timeHorizonDays },
    earning_lanes: lanes,
    recommended_primary_lane: primary,
    confidence,
    generatedAt: new Date().toISOString(),
  });
};

const weeklyPlan: ToolHandler = async (raw) => {
  const input = parseInput<EarnpathWeeklyPlanInput>(raw);
  const strategyId = String(input?.income_map?.strategy_id || `ep_${Date.now()}`);
  const primaryLane = String(input?.income_map?.recommended_primary_lane || 'provider-ops-services');
  const monthlyGoal = Math.max(0, toNumber(input?.targets?.monthly_income_goal_usd, 500));
  const weeks = [1, 2, 3, 4].map((week) => {
    const actions = [
      {
        task_id: `w${week}_t1`,
        description: `Publish one high-intent offer in lane: ${primaryLane}`,
        owner: 'human',
        estimated_hours: 2 + (week % 2),
        expected_output_artifact: 'offer_page_or_listing_url',
      },
      {
        task_id: `w${week}_t2`,
        description: 'Run paid provider traffic scan and update target list',
        owner: 'agent',
        estimated_hours: 1,
        expected_output_artifact: 'provider_traffic.csv',
      },
      {
        task_id: `w${week}_t3`,
        description: 'Execute one outreach / route optimization experiment',
        owner: 'agent',
        estimated_hours: 1.5,
        expected_output_artifact: 'experiment_result.json',
      },
    ];
    return { week_number: week, actions };
  });

  return JSON.stringify({
    model: 'earnpath/weekly-plan',
    plan_id: `epp_${Date.now()}`,
    strategy_id: strategyId,
    lane: primaryLane,
    monthly_goal_usd: monthlyGoal,
    weeks,
    success_metrics: [
      { metric: 'paid_calls_per_week', target: '>= 10 by week 4' },
      { metric: 'qualified_revenue_events', target: '>= 3 by week 4' },
      { metric: 'weekly_repeat_usage', target: '>= 25%' },
    ],
    generatedAt: new Date().toISOString(),
  });
};

const riskCheck: ToolHandler = async (raw) => {
  const input = parseInput<EarnpathRiskCheckInput>(raw);
  const actions = Array.isArray(input?.proposed_actions) ? input.proposed_actions : [];
  const riskProfile = normalizeRisk(input?.profile?.risk_tolerance);
  const scored = actions.map((a: any) => ({ action: a, score: scoreAction(a) }));
  const avg = scored.length ? scored.reduce((sum, s) => sum + s.score, 0) / scored.length : 45;
  const profilePenalty = riskProfile === 'high' ? 6 : riskProfile === 'low' ? -4 : 0;
  const riskScore = Number(clamp(100 - avg + profilePenalty, 5, 95).toFixed(2));
  const goNoGo = riskScore <= 35 ? 'go' : riskScore <= 65 ? 'conditional' : 'no_go';

  const blockers: string[] = [];
  if (!input?.profile?.hours_per_week || toInteger(input.profile.hours_per_week, 0) < 5) blockers.push('insufficient_weekly_time_budget');
  if (!input?.targets?.monthly_income_goal_usd) blockers.push('missing_monthly_income_goal');
  if (actions.length === 0) blockers.push('no_proposed_actions');

  return JSON.stringify({
    model: 'earnpath/risk-check',
    risk_score: riskScore,
    blocking_issues: blockers,
    recommended_mitigations: [
      'prioritize one lane until first repeat revenue signal',
      'set weekly stop-loss on low-performing experiments',
      'enforce artifact logging for every revenue attempt',
    ],
    go_no_go: blockers.length > 0 ? 'no_go' : goNoGo,
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['earnpath/income-map', incomeMap],
  ['earnpath/weekly-plan', weeklyPlan],
  ['earnpath/risk-check', riskCheck],
]);
