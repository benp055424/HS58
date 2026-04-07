import type {
  CapitalPolicy,
  CashflowProviderRow,
  CashflowRevenueScoreboardInput,
  CashflowReinvestPolicyInput,
  CashflowFlywheelTunerInput,
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

function normalizeRisk(risk: unknown): 'low' | 'medium' | 'high' {
  const r = String(risk || '').toLowerCase();
  if (r === 'low' || r === 'high') return r;
  return 'medium';
}

function rowRevenueMid(row: CashflowProviderRow): number {
  const min = Math.max(0, toNumber(row.est_earned_min_usd, 0));
  const max = Math.max(min, toNumber(row.est_earned_max_usd, min));
  return (min + max) / 2;
}

function cleanRows(input: any): CashflowProviderRow[] {
  const providers = input?.traffic_data?.providers;
  if (!Array.isArray(providers)) return [];
  return providers
    .map((r: any) => ({
      provider: String(r?.provider || '').trim(),
      vouchers: Math.max(0, toInteger(r?.vouchers, 0)),
      active_channels: Math.max(0, toInteger(r?.active_channels, 0)),
      est_earned_min_usd: Math.max(0, toNumber(r?.est_earned_min_usd, 0)),
      est_earned_max_usd: Math.max(0, toNumber(r?.est_earned_max_usd, 0)),
    }))
    .filter((r) => r.provider.length > 0);
}

function normalizePolicy(policy: CapitalPolicy | undefined): CapitalPolicy {
  const reserve = clamp(toNumber(policy?.reserve_ratio, 0.3), 0, 1);
  const reinvest = clamp(toNumber(policy?.reinvest_ratio, 0.5), 0, 1);
  const tao = clamp(toNumber(policy?.tao_accumulation_ratio, 0.2), 0, 1);
  const sum = reserve + reinvest + tao;
  if (sum <= 0.0001) {
    return { reserve_ratio: 0.3, reinvest_ratio: 0.5, tao_accumulation_ratio: 0.2 };
  }
  return {
    reserve_ratio: Number((reserve / sum).toFixed(4)),
    reinvest_ratio: Number((reinvest / sum).toFixed(4)),
    tao_accumulation_ratio: Number((tao / sum).toFixed(4)),
  };
}

function rankPriority(momentum: number, efficiency: number): 'scale' | 'maintain' | 'fix' | 'prune' {
  if (momentum >= 70 && efficiency >= 60) return 'scale';
  if (momentum >= 40 && efficiency >= 40) return 'maintain';
  if (momentum >= 20 || efficiency >= 25) return 'fix';
  return 'prune';
}

const revenueScoreboard: ToolHandler = async (raw) => {
  const input = parseInput<CashflowRevenueScoreboardInput>(raw);
  const windowDays = clamp(toInteger(input.window_days, 30), 7, 180);
  const rows = cleanRows(input);
  const totals = rows.reduce(
    (acc, row) => {
      acc.vouchers += row.vouchers;
      acc.channels += row.active_channels;
      acc.min += row.est_earned_min_usd;
      acc.max += row.est_earned_max_usd;
      return acc;
    },
    { vouchers: 0, channels: 0, min: 0, max: 0 }
  );

  const avgVouchers = rows.length ? totals.vouchers / rows.length : 0;
  const avgMid = rows.length ? rows.reduce((sum, r) => sum + rowRevenueMid(r), 0) / rows.length : 0;

  const scoreboard = rows
    .map((row) => {
      const mid = rowRevenueMid(row);
      const voucherLift = avgVouchers > 0 ? row.vouchers / avgVouchers : 0;
      const revenueLift = avgMid > 0 ? mid / avgMid : 0;
      const channelEfficiency = row.active_channels > 0 ? row.vouchers / row.active_channels : row.vouchers;
      const momentum = clamp((voucherLift * 35) + (revenueLift * 35) + (channelEfficiency * 3.2), 0, 100);
      const efficiency = clamp((channelEfficiency * 10) + (revenueLift * 30), 0, 100);
      return {
        provider: row.provider,
        momentum_score: Number(momentum.toFixed(2)),
        efficiency_score: Number(efficiency.toFixed(2)),
        priority: rankPriority(momentum, efficiency),
      };
    })
    .sort((a, b) => b.momentum_score - a.momentum_score);

  return JSON.stringify({
    model: 'cashflowops/revenue-scoreboard',
    window_days: windowDays,
    scoreboard,
    portfolio_totals: {
      providers: rows.length,
      total_vouchers: totals.vouchers,
      total_active_channels: totals.channels,
      est_earned_min_usd: Number(totals.min.toFixed(6)),
      est_earned_max_usd: Number(totals.max.toFixed(6)),
      est_earned_mid_usd: Number(((totals.min + totals.max) / 2).toFixed(6)),
    },
    generatedAt: new Date().toISOString(),
  });
}

const reinvestPolicy: ToolHandler = async (raw) => {
  const input = parseInput<CashflowReinvestPolicyInput>(raw);
  const rows = cleanRows(input);
  const riskBudget = normalizeRisk(input.risk_budget);
  const available = Math.max(0, toNumber(input.available_capital_usd, 0));
  const policy = normalizePolicy(input.capital_policy);

  const riskAdjust = riskBudget === 'low' ? { reserve: 0.08, build: -0.04, tao: -0.04 } :
    riskBudget === 'high' ? { reserve: -0.06, build: 0.04, tao: 0.02 } :
      { reserve: 0, build: 0, tao: 0 };

  const reservePct = clamp((policy.reserve_ratio + riskAdjust.reserve) * 100, 10, 55);
  const taoPct = clamp((policy.tao_accumulation_ratio + riskAdjust.tao) * 100, 5, 45);
  const reinvestPct = clamp(100 - reservePct - taoPct, 15, 70);

  const buildPct = clamp(reinvestPct * 0.45 + riskAdjust.build * 100, 8, reinvestPct - 10);
  const marketingPct = clamp(reinvestPct * 0.25, 5, reinvestPct - buildPct - 5);
  const opsPct = clamp(reinvestPct - buildPct - marketingPct, 5, 30);

  const allocation_plan = [
    { bucket: 'build', percent: Number(buildPct.toFixed(2)), usd_amount: Number(((buildPct / 100) * available).toFixed(2)) },
    { bucket: 'marketing', percent: Number(marketingPct.toFixed(2)), usd_amount: Number(((marketingPct / 100) * available).toFixed(2)) },
    { bucket: 'ops', percent: Number(opsPct.toFixed(2)), usd_amount: Number(((opsPct / 100) * available).toFixed(2)) },
    { bucket: 'tao_buy', percent: Number(taoPct.toFixed(2)), usd_amount: Number(((taoPct / 100) * available).toFixed(2)) },
    { bucket: 'reserve', percent: Number(reservePct.toFixed(2)), usd_amount: Number(((reservePct / 100) * available).toFixed(2)) },
  ];

  const top = rows
    .map((r) => ({ provider: r.provider, mid: rowRevenueMid(r) }))
    .sort((a, b) => b.mid - a.mid)
    .slice(0, 3)
    .map((r) => r.provider);

  return JSON.stringify({
    model: 'cashflowops/reinvest-policy',
    window_days: clamp(toInteger(input.window_days, 30), 7, 180),
    risk_budget: riskBudget,
    available_capital_usd: Number(available.toFixed(2)),
    allocation_plan,
    decision_rationale: [
      `Capital policy normalized to reserve=${policy.reserve_ratio}, reinvest=${policy.reinvest_ratio}, tao=${policy.tao_accumulation_ratio}.`,
      `Top cashflow sources observed: ${top.length ? top.join(', ') : 'no-provider-data'}.`,
      'Reinvest buckets favor build + distribution while preserving reserve and TAO accumulation.',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const flywheelTuner: ToolHandler = async (raw) => {
  const input = parseInput<CashflowFlywheelTunerInput>(raw);
  const rows = cleanRows(input);
  const windowDays = clamp(toInteger(input.window_days, 30), 7, 180);
  const experimentBudget = Math.max(0, toNumber(input.experiment_budget_usd, 120));
  const top = rows
    .map((r) => ({ provider: r.provider, mid: rowRevenueMid(r), vouchers: r.vouchers }))
    .sort((a, b) => (b.mid + b.vouchers) - (a.mid + a.vouchers))
    .slice(0, 2);

  const experiments = [
    {
      experiment_id: `cf_exp_${Date.now()}_1`,
      hypothesis: `Bundling ${top[0]?.provider || 'top-provider'} outputs into execpath proofs will raise repeat paid calls.`,
      metric: 'week_over_week_repeat_paid_calls',
      guardrail: 'do_not_exceed_20_percent_price_increase',
      duration_days: 14,
    },
    {
      experiment_id: `cf_exp_${Date.now()}_2`,
      hypothesis: 'Publishing weekly scoreboard + plan artifacts will increase conversion to paid workflows.',
      metric: 'trial_to_paid_conversion_rate',
      guardrail: 'maintain_p95_latency_below_1200ms',
      duration_days: 14,
    },
    {
      experiment_id: `cf_exp_${Date.now()}_3`,
      hypothesis: 'Reallocating low-efficiency providers to maintain/fix lanes improves blended margin.',
      metric: 'blended_margin_per_paid_call',
      guardrail: 'reserve_ratio_never_below_20_percent',
      duration_days: 21,
    },
  ];

  const expectedLiftLow = clamp(6 + (rows.length > 3 ? 2 : 0), 3, 18);
  const expectedLiftHigh = clamp(expectedLiftLow + 8 + Math.floor(experimentBudget / 200), 8, 35);

  return JSON.stringify({
    model: 'cashflowops/flywheel-tuner',
    window_days: windowDays,
    experiments,
    expected_lift: {
      paid_call_growth_percent_min: expectedLiftLow,
      paid_call_growth_percent_max: expectedLiftHigh,
      horizon_days: 30,
    },
    experiment_budget_usd: Number(experimentBudget.toFixed(2)),
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['cashflowops/revenue-scoreboard', revenueScoreboard],
  ['cashflowops/reinvest-policy', reinvestPolicy],
  ['cashflowops/flywheel-tuner', flywheelTuner],
]);
