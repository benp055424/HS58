import type { CapitalPlanInput, LeveragePolicyInput, LiquidityBufferInput, ToolHandler } from './types.js';

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

const capitalPlan: ToolHandler = async (raw) => {
  const input = parseInput<CapitalPlanInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const monthlyBurn = Math.max(100, toNumber(input.monthlyBurnUsd, role === 'validator' ? 900 : 520));
  const monthlyRevenue = Math.max(0, toNumber(input.monthlyRevenueUsd, role === 'validator' ? 720 : 410));
  const cash = Math.max(0, toNumber(input.cashOnHandUsd, role === 'validator' ? 4800 : 2600));
  const targetRunway = Math.max(1, Math.min(36, Math.floor(toNumber(input.targetRunwayMonths, 6))));
  const capex = Math.max(0, toNumber(input.plannedCapexUsd, 1500));
  const risk = input.riskTolerance || 'balanced';

  const netMonthly = monthlyRevenue - monthlyBurn;
  const riskFactor = risk === 'aggressive' ? 0.85 : risk === 'conservative' ? 1.15 : 1.0;
  const deficitMonthly = Math.max(0, -netMonthly);
  const impliedRunwayMonths =
    deficitMonthly > 0
      ? Number(Math.min(999, cash / deficitMonthly).toFixed(4))
      : Number((cash / Math.max(1, monthlyBurn * 0.25)).toFixed(4));
  const requiredBuffer = Number((monthlyBurn * targetRunway * riskFactor).toFixed(4));
  const shortfallUsd = Number(Math.max(0, requiredBuffer - cash + capex).toFixed(4));
  const fundingPriority = shortfallUsd > 5000 ? 'raise-or-cut-burn' : shortfallUsd > 500 ? 'optimize-cash' : 'maintain-buffer';

  return JSON.stringify({
    subnet,
    role,
    monthlyBurnUsd: Number(monthlyBurn.toFixed(4)),
    monthlyRevenueUsd: Number(monthlyRevenue.toFixed(4)),
    netMonthlyUsd: Number(netMonthly.toFixed(4)),
    cashOnHandUsd: Number(cash.toFixed(4)),
    targetRunwayMonths: targetRunway,
    plannedCapexUsd: Number(capex.toFixed(4)),
    riskTolerance: risk,
    impliedRunwayMonths,
    requiredLiquidityUsd: requiredBuffer,
    capitalShortfallUsd: shortfallUsd,
    fundingPriority,
    milestones: [
      { name: 'stabilize-burn', weeks: 2, action: 'trim non-core spend and defer discretionary capex' },
      { name: 'secure-runway', weeks: 4, action: 'align treasury to target months of gross burn cover' },
      { name: 'revenue-path', weeks: 8, action: 'tie revenue assumptions to measurable subnet KPIs' },
    ],
    generatedAt: new Date().toISOString(),
  });
};

const leveragePolicy: ToolHandler = async (raw) => {
  const input = parseInput<LeveragePolicyInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const debt = Math.max(0, toNumber(input.currentDebtUsd, role === 'validator' ? 3200 : 1800));
  const equity = Math.max(1, toNumber(input.equityUsd, role === 'validator' ? 12000 : 6500));
  const maxLev = Math.max(0.5, Math.min(5, toNumber(input.maxAcceptableLeverage, role === 'validator' ? 1.8 : 1.4)));
  const vol = Math.max(0, Math.min(1, toNumber(input.revenueVolatility, 0.22)));
  const haircut = Math.max(0.05, Math.min(0.6, toNumber(input.collateralHaircut, 0.12)));

  const leverageRatio = Number((debt / equity).toFixed(4));
  const volAdjustment = Number((1 - vol * 0.35).toFixed(4));
  const effectiveCap = Number(Math.max(0.1, maxLev * volAdjustment * (1 - haircut)).toFixed(4));
  const headroom = Number(Math.max(0, effectiveCap - leverageRatio).toFixed(4));
  const policyStance =
    leverageRatio > effectiveCap ? 'deleverage-now' : leverageRatio > effectiveCap * 0.85 ? 'hold-no-new-debt' : 'within-policy';

  return JSON.stringify({
    subnet,
    role,
    currentDebtUsd: Number(debt.toFixed(4)),
    equityUsd: Number(equity.toFixed(4)),
    leverageRatio,
    maxAcceptableLeverage: maxLev,
    revenueVolatility: Number(vol.toFixed(4)),
    collateralHaircut: Number(haircut.toFixed(4)),
    effectiveLeverageCap: effectiveCap,
    headroomToCap: headroom,
    policyStance,
    rules: [
      { rule: 'no-new-draws', condition: leverageRatio >= effectiveCap * 0.9, active: leverageRatio >= effectiveCap * 0.85 },
      { rule: 'amortize-principal', condition: vol > 0.25, active: vol > 0.2 },
      { rule: 'maintain-equity-cushion', condition: equity < debt * 2, active: equity < debt * 2.5 },
    ],
    generatedAt: new Date().toISOString(),
  });
};

const liquidityBuffer: ToolHandler = async (raw) => {
  const input = parseInput<LiquidityBufferInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const weeklyOpex = Math.max(50, toNumber(input.weeklyOperatingUsd, role === 'validator' ? 420 : 240));
  const weeklyInflow = Math.max(0, toNumber(input.weeklyInflowUsd, role === 'validator' ? 380 : 210));
  const liquid = Math.max(0, toNumber(input.currentLiquidUsd, role === 'validator' ? 2100 : 1200));
  const targetDays = Math.max(7, Math.min(120, Math.floor(toNumber(input.targetDaysCover, 30))));
  const lag = Math.max(0, Math.min(30, Math.floor(toNumber(input.payoutLagDays, 5))));

  const dailyNet = (weeklyInflow - weeklyOpex) / 7;
  const targetUsd = Number(((weeklyOpex / 7) * targetDays).toFixed(4));
  const lagBufferUsd = Number(((weeklyOpex / 7) * lag).toFixed(4));
  const totalRecommended = Number((targetUsd + lagBufferUsd).toFixed(4));
  const gapUsd = Number(Math.max(0, totalRecommended - liquid).toFixed(4));
  const weeksOfCover = Number((liquid / Math.max(1, weeklyOpex)).toFixed(4));
  const bufferStatus = gapUsd <= 0 ? 'adequate' : gapUsd < weeklyOpex ? 'tight' : 'under-buffer';

  return JSON.stringify({
    subnet,
    role,
    weeklyOperatingUsd: Number(weeklyOpex.toFixed(4)),
    weeklyInflowUsd: Number(weeklyInflow.toFixed(4)),
    dailyNetUsd: Number(dailyNet.toFixed(4)),
    currentLiquidUsd: Number(liquid.toFixed(4)),
    targetDaysCover: targetDays,
    payoutLagDays: lag,
    targetOperatingBufferUsd: targetUsd,
    payoutLagBufferUsd: lagBufferUsd,
    recommendedTotalLiquidUsd: totalRecommended,
    liquidityGapUsd: gapUsd,
    weeksOfOperatingCover: weeksOfCover,
    bufferStatus,
    actions: [
      'ring-fence liquid USDC for opex and payouts separate from trading wallets',
      'size buffer to worst-week outflow using trailing 8-week max',
      'add a 1-week contingency on top when payout cadence is irregular',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['fundingops/capital-plan', capitalPlan],
  ['fundingops/leverage-policy', leveragePolicy],
  ['fundingops/liquidity-buffer', liquidityBuffer],
]);
