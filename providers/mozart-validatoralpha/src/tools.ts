import type {
  CommissionStrategyInput,
  DelegationPricingInput,
  RewardCurveInput,
  ToolHandler,
} from './types.js';

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

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const commissionStrategy: ToolHandler = async (raw) => {
  const input = parseInput<CommissionStrategyInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const validatorStakeTao = Math.max(0, toNumber(input.validatorStakeTao, 256));
  const targetTakeRatePct = clamp(toNumber(input.targetTakeRatePct, 17), 0, 50);
  const competitorAvg = clamp(toNumber(input.competitorAvgCommissionPct, 18), 0, 50);
  const epochsHorizon = Math.max(1, Math.min(365, Math.floor(toNumber(input.epochsHorizon, 30))));

  const stakeWeight = clamp(validatorStakeTao / 512, 0, 1);
  const competitiveGap = competitorAvg - targetTakeRatePct;
  const adjustment = clamp(0.15 * competitiveGap + 0.08 * (1 - stakeWeight), -3, 4);
  const suggestedCommissionPct = Number(clamp(targetTakeRatePct + adjustment, 0, 50).toFixed(4));
  const delegatorAttractionScore = Number(
    clamp(1 - suggestedCommissionPct / 100 + 0.2 * stakeWeight, 0, 1).toFixed(4)
  );
  const netYieldIndex = Number(
    clamp(0.55 * (suggestedCommissionPct / 100) + 0.35 * stakeWeight + 0.1 * (epochsHorizon / 365), 0, 1).toFixed(4)
  );

  return JSON.stringify({
    subnetId,
    validatorStakeTao: Number(validatorStakeTao.toFixed(4)),
    targetTakeRatePct: Number(targetTakeRatePct.toFixed(4)),
    competitorAvgCommissionPct: Number(competitorAvg.toFixed(4)),
    epochsHorizon,
    suggestedCommissionPct,
    delegatorAttractionScore,
    netYieldIndex,
    rationale: [
      'suggested rate blends your target take with peer commission and stake-weight competitiveness',
      'higher stake weight supports a slightly higher take without equal loss in delegation appeal',
    ],
    actions: [
      'publish transparent commission schedule and any future change notice period',
      'simulate delegator APR at suggested rate versus subnet median for messaging',
      'review rate each epoch block for competitiveness and operating cost coverage',
    ],
    model: 'validatoralpha/commission-strategy',
    generatedAt: new Date().toISOString(),
  });
};

const delegationPricing: ToolHandler = async (raw) => {
  const input = parseInput<DelegationPricingInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const minDelegationTao = Math.max(0.01, toNumber(input.minDelegationTao, 2));
  const desiredFillRate = clamp(toNumber(input.desiredFillRate, 0.72), 0.1, 1);
  const peerMedianCommissionPct = clamp(toNumber(input.peerMedianCommissionPct, 18), 0, 50);
  const operatingCostUsdMonthly = Math.max(0, toNumber(input.operatingCostUsdMonthly, 420));

  const costPressure = clamp(operatingCostUsdMonthly / 2000, 0, 1);
  const recommendedMinDelegateTao = Number(
    (minDelegationTao * (1 + 0.25 * (1 - desiredFillRate) + 0.15 * costPressure)).toFixed(4)
  );
  const feeTierLowPct = Number(clamp(peerMedianCommissionPct * 0.92, 0, 50).toFixed(4));
  const feeTierHighPct = Number(clamp(peerMedianCommissionPct * 1.08, 0, 50).toFixed(4));
  const attractivenessScore = Number(
    clamp(0.5 * desiredFillRate + 0.3 * (1 - costPressure) + 0.2 * (1 - feeTierHighPct / 100), 0, 1).toFixed(4)
  );

  return JSON.stringify({
    subnetId,
    minDelegationTao: Number(minDelegationTao.toFixed(4)),
    desiredFillRate: Number(desiredFillRate.toFixed(4)),
    peerMedianCommissionPct: Number(peerMedianCommissionPct.toFixed(4)),
    operatingCostUsdMonthly: Number(operatingCostUsdMonthly.toFixed(4)),
    recommendedMinDelegateTao,
    feeSchedule: {
      lowPct: feeTierLowPct,
      targetPct: Number(peerMedianCommissionPct.toFixed(4)),
      highPct: feeTierHighPct,
    },
    attractivenessScore,
    notes: [
      'minimum delegation is raised when fill-rate targets are aggressive or costs are elevated',
      'fee band tracks peer median with a tight spread for predictable delegator expectations',
    ],
    model: 'validatoralpha/delegation-pricing',
    generatedAt: new Date().toISOString(),
  });
};

const rewardCurve: ToolHandler = async (raw) => {
  const input = parseInput<RewardCurveInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const emissionPerEpochTao = Math.max(0.0001, toNumber(input.emissionPerEpochTao, 0.42));
  const delegationMultiple = Math.max(0.5, toNumber(input.delegationMultiple, 1.15));
  const epochs = Math.max(1, Math.min(720, Math.floor(toNumber(input.epochs, 90))));
  const baseStakeTao = Math.max(1, toNumber(input.baseStakeTao, 128));

  const effectiveEmission = emissionPerEpochTao * delegationMultiple;
  const stakeFactor = clamp(baseStakeTao / 256, 0.25, 2);
  const step = Math.max(1, Math.floor(epochs / 12));

  const prefixCumulative: number[] = [0];
  for (let e = 1; e <= epochs; e++) {
    const share = stakeFactor * (0.55 + 0.45 * (e / epochs));
    prefixCumulative[e] = prefixCumulative[e - 1]! + effectiveEmission * share;
  }
  const projectedTotalTao = Number(prefixCumulative[epochs]!.toFixed(6));

  const curve: Array<{ epoch: number; cumulativeTao: number }> = [{ epoch: 0, cumulativeTao: 0 }];
  for (let e = step; e < epochs; e += step) {
    curve.push({ epoch: e, cumulativeTao: Number(prefixCumulative[e]!.toFixed(6)) });
  }
  if (curve[curve.length - 1]?.epoch !== epochs) {
    curve.push({ epoch: epochs, cumulativeTao: projectedTotalTao });
  }

  const inflectionEpoch = Math.floor(epochs * 0.42);

  return JSON.stringify({
    subnetId,
    emissionPerEpochTao: Number(emissionPerEpochTao.toFixed(6)),
    delegationMultiple: Number(delegationMultiple.toFixed(4)),
    epochs,
    baseStakeTao: Number(baseStakeTao.toFixed(4)),
    projectedTotalTao,
    inflectionEpoch,
    curveSample: curve,
    sensitivity: {
      emissionPlus10Pct: Number((projectedTotalTao * 1.1).toFixed(6)),
      emissionMinus10Pct: Number((projectedTotalTao * 0.9).toFixed(6)),
    },
    disclaimer: 'projection uses a deterministic stake-weight ramp; validate against live subnet emissions.',
    model: 'validatoralpha/reward-curve',
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['validatoralpha/commission-strategy', commissionStrategy],
  ['validatoralpha/delegation-pricing', delegationPricing],
  ['validatoralpha/reward-curve', rewardCurve],
]);
