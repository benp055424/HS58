import type { RunwayForecastInput, CostEnvelopeInput, ReinvestmentPlanInput, ToolHandler } from './types.js';

function parseInput<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

const runwayForecast: ToolHandler = async (raw) => {
  const input = parseInput<RunwayForecastInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const liquidUsd = Math.max(0, toNumber(input.liquidUsd, 50_000));
  const monthlyBurnUsd = Math.max(1, toNumber(input.monthlyBurnUsd, 8_000));
  const monthlyInflowUsd = Math.max(0, toNumber(input.monthlyInflowUsd, 6_200));
  const targetRunwayMonths = clamp(Math.floor(toNumber(input.targetRunwayMonths, 6)), 1, 36);

  const netMonthlyDrainUsd = monthlyBurnUsd - monthlyInflowUsd;
  let runwayMonthsRaw: number;
  if (netMonthlyDrainUsd <= 1e-9) {
    runwayMonthsRaw = 240;
  } else {
    runwayMonthsRaw = liquidUsd / netMonthlyDrainUsd;
  }

  const runwayMonthsCapped = Number(clamp(runwayMonthsRaw, 0, 1200).toFixed(4));
  const gapToTarget = Number((targetRunwayMonths - runwayMonthsCapped).toFixed(4));
  const status =
    runwayMonthsCapped >= targetRunwayMonths
      ? 'above-target'
      : runwayMonthsCapped >= targetRunwayMonths * 0.75
        ? 'near-target'
        : 'below-target';

  return JSON.stringify({
    model: 'treasuryops/runway-forecast',
    subnetId,
    inputs: {
      liquidUsd: Number(liquidUsd.toFixed(4)),
      monthlyBurnUsd: Number(monthlyBurnUsd.toFixed(4)),
      monthlyInflowUsd: Number(monthlyInflowUsd.toFixed(4)),
      netMonthlyDrainUsd: Number(netMonthlyDrainUsd.toFixed(4)),
      targetRunwayMonths,
    },
    runwayMonths: runwayMonthsCapped,
    gapToTargetMonths: gapToTarget,
    status,
    actions: [
      netMonthlyDrainUsd > 0 ? 'reduce burn or increase inflows to extend runway' : 'surplus or break-even extends effective runway; still track liquidity risk',
      'stress-test a 20% burn spike and 15% inflow drop for two quarters',
      'align delegate payouts and fixed costs with rolling 13-week cash view',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const costEnvelope: ToolHandler = async (raw) => {
  const input = parseInput<CostEnvelopeInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const budgetUsd = Math.max(100, toNumber(input.budgetUsd, 25_000));
  const horizonMonths = clamp(Math.floor(toNumber(input.horizonMonths, 12)), 1, 60);
  const riskTolerance = input.riskTolerance ?? 'medium';
  const fixedShare = clamp(toNumber(input.fixedCostShare, 0.42), 0.1, 0.9);

  const riskFactor = riskTolerance === 'high' ? 1.15 : riskTolerance === 'low' ? 0.9 : 1.0;
  const monthlyCap = (budgetUsd / horizonMonths) * riskFactor;
  const weeklyCap = monthlyCap / 4.345;
  const dailyCap = monthlyCap / 30;
  const fixedBudget = monthlyCap * fixedShare;
  const variableBudget = monthlyCap * (1 - fixedShare);

  const alertAtPct = riskTolerance === 'high' ? 0.92 : riskTolerance === 'low' ? 0.78 : 0.85;

  return JSON.stringify({
    model: 'treasuryops/cost-envelope',
    subnetId,
    horizonMonths,
    riskTolerance,
    envelope: {
      totalBudgetUsd: Number(budgetUsd.toFixed(4)),
      monthlyCapUsd: Number(monthlyCap.toFixed(6)),
      weeklyCapUsd: Number(weeklyCap.toFixed(6)),
      dailyCapUsd: Number(dailyCap.toFixed(6)),
      fixedMonthlyUsd: Number(fixedBudget.toFixed(6)),
      variableMonthlyUsd: Number(variableBudget.toFixed(6)),
      alertThresholdUsd: Number((monthlyCap * alertAtPct).toFixed(6)),
    },
    notes: [
      'envelope is deterministic from inputs; reconcile with actual invoices weekly',
      'treat delegate and infra as fixed unless contractually variable',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const reinvestmentPlan: ToolHandler = async (raw) => {
  const input = parseInput<ReinvestmentPlanInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const availableUsd = Math.max(0, toNumber(input.availableUsd, 12_000));
  const reinvestRate = clamp(toNumber(input.reinvestRate, 0.35), 0, 1);
  const goalUsd = Math.max(availableUsd, toNumber(input.goalUsd, 40_000));
  const horizonMonths = clamp(Math.floor(toNumber(input.horizonMonths, 9)), 1, 48);

  const monthlyReinvest = availableUsd * reinvestRate;
  const monthsToGoal =
    monthlyReinvest <= 0 ? horizonMonths : Math.ceil((goalUsd - availableUsd) / monthlyReinvest);

  const schedule = Array.from({ length: Math.min(horizonMonths, 12) }, (_, i) => {
    const month = i + 1;
    const cumulative = Number((monthlyReinvest * month).toFixed(4));
    return { month, reinvestUsd: Number(monthlyReinvest.toFixed(6)), cumulativeReinvestUsd: cumulative };
  });

  return JSON.stringify({
    model: 'treasuryops/reinvestment-plan',
    subnetId,
    availableUsd: Number(availableUsd.toFixed(4)),
    reinvestRate: Number(reinvestRate.toFixed(4)),
    goalUsd: Number(goalUsd.toFixed(4)),
    horizonMonths,
    monthlyReinvestUsd: Number(monthlyReinvest.toFixed(6)),
    estimatedMonthsToGoal: Math.min(monthsToGoal, 999),
    schedule,
    recommendation:
      reinvestRate >= 0.25 && monthlyReinvest > 0 ? 'execute-staged-reinvest' : 'increase-available-or-goal-clarity',
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['treasuryops/runway-forecast', runwayForecast],
  ['treasuryops/cost-envelope', costEnvelope],
  ['treasuryops/reinvestment-plan', reinvestmentPlan],
]);
