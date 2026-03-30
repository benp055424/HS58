import type {
  SubnetAllocationInput,
  RoleAllocationInput,
  RebalancePlanInput,
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
  return Math.max(lo, Math.min(hi, n));
}

/** Deterministic pseudo-rank from string key (0..1) */
function keyScore(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return (h % 10_000) / 10_000;
}

const subnetAllocation: ToolHandler = async (raw) => {
  const input = parseInput<SubnetAllocationInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const capitalUsd = Math.max(0, toNumber(input.capitalUsd, 5000));
  const riskProfile = input.riskProfile ?? 'balanced';
  const horizonDays = clamp(Math.floor(toNumber(input.horizonDays, 30)), 7, 365);
  const minLiquidityScore = clamp(toNumber(input.minLiquidityScore, 0.5), 0, 1);

  const riskWeight = riskProfile === 'aggressive' ? 1.15 : riskProfile === 'conservative' ? 0.88 : 1.0;
  const slices = ['alpha', 'core', 'hedge', 'reserve'].map((label, i) => {
    const k = keyScore(`${subnetId}:${label}:${horizonDays}`);
    const weight = clamp(0.18 + k * 0.22 * riskWeight + (1 - minLiquidityScore) * 0.05, 0.05, 0.45);
    const usd = Number(((capitalUsd * weight) / 4 + i * (capitalUsd * 0.01)).toFixed(2));
    return {
      bucket: label,
      weight: Number(weight.toFixed(4)),
      allocatedUsd: usd,
      score: Number((k * minLiquidityScore + 0.2).toFixed(4)),
    };
  });

  const totalWeight = slices.reduce((s, x) => s + x.weight, 0);
  const normalized = slices.map((s) => ({
    ...s,
    weight: Number((s.weight / totalWeight).toFixed(4)),
  }));

  return JSON.stringify({
    model: 'allocator/subnet-allocation',
    subnetId,
    capitalUsd: Number(capitalUsd.toFixed(4)),
    riskProfile,
    horizonDays,
    minLiquidityScore: Number(minLiquidityScore.toFixed(4)),
    subnetAllocation: normalized,
    notes: [
      'weights are deterministic from subnetId + horizon + liquidity floor',
      're-scale weekly if emissions or liquidity assumptions change',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const roleAllocation: ToolHandler = async (raw) => {
  const input = parseInput<RoleAllocationInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const capitalUsd = Math.max(100, toNumber(input.capitalUsd, 3000));
  const opsHoursPerDay = clamp(toNumber(input.opsHoursPerDay, 8), 1, 24);
  const targetRisk = input.targetRisk ?? 'medium';
  const uptimeTarget = clamp(toNumber(input.uptimeTarget, 0.97), 0.5, 1);

  const riskFactor = targetRisk === 'high' ? 1.12 : targetRisk === 'low' ? 0.9 : 1.0;
  const opsFactor = clamp(opsHoursPerDay / 12, 0.75, 1.15);
  const baseValidator = 0.42 * riskFactor * opsFactor * uptimeTarget;
  const baseMiner = 0.58 * (2 - riskFactor * 0.95) * (1.05 - uptimeTarget * 0.03);
  const total = Math.max(1e-6, baseValidator + baseMiner);
  const validatorShare = clamp(baseValidator / total, 0.2, 0.8);
  const minerShare = Number((1 - validatorShare).toFixed(4));

  const validatorBudgetUsd = Number((capitalUsd * validatorShare).toFixed(2));
  const minerBudgetUsd = Number((capitalUsd * minerShare).toFixed(2));

  return JSON.stringify({
    model: 'allocator/role-allocation',
    subnetId,
    capitalUsd: Number(capitalUsd.toFixed(4)),
    opsHoursPerDay: Number(opsHoursPerDay.toFixed(4)),
    targetRisk,
    uptimeTarget: Number(uptimeTarget.toFixed(4)),
    roleAllocation: {
      validatorShare: Number(validatorShare.toFixed(4)),
      minerShare,
      validatorBudgetUsd,
      minerBudgetUsd,
    },
    recommendation: validatorShare >= minerShare ? 'validator-led' : 'miner-led',
    generatedAt: new Date().toISOString(),
  });
};

const rebalancePlan: ToolHandler = async (raw) => {
  const input = parseInput<RebalancePlanInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const currentMinerShare = clamp(toNumber(input.currentMinerShare, 0.55), 0, 1);
  const currentValidatorShare = clamp(toNumber(input.currentValidatorShare, 0.45), 0, 1);
  const targetDrawdown = clamp(toNumber(input.targetDrawdown, 0.08), 0.01, 0.5);
  const horizonDays = clamp(Math.floor(toNumber(input.horizonDays, 28)), 7, 180);
  const rebalanceBudgetUsd = Math.max(0, toNumber(input.rebalanceBudgetUsd, 500));

  const sum = currentMinerShare + currentValidatorShare;
  const m = sum > 0 ? currentMinerShare / sum : 0.5;
  const drawdownPressure = clamp(targetDrawdown * 1.4, 0, 0.25);
  const shift = clamp((0.5 - m) * 0.15 - drawdownPressure * 0.08, -0.12, 0.12);
  const targetMinerShare = clamp(m + shift, 0.15, 0.85);
  const targetValidatorShare = Number((1 - targetMinerShare).toFixed(4));
  const steps = Math.max(1, Math.min(8, Math.ceil(horizonDays / 7)));

  return JSON.stringify({
    model: 'allocator/rebalance-plan',
    subnetId,
    currentMinerShare: Number(currentMinerShare.toFixed(4)),
    currentValidatorShare: Number(currentValidatorShare.toFixed(4)),
    targetDrawdown: Number(targetDrawdown.toFixed(4)),
    horizonDays,
    rebalanceBudgetUsd: Number(rebalanceBudgetUsd.toFixed(4)),
    rebalancePlan: {
      targetMinerShare: Number(targetMinerShare.toFixed(4)),
      targetValidatorShare,
      shiftApplied: Number(shift.toFixed(4)),
      cadence: 'weekly',
      stepsPlanned: steps,
      budgetPerStepUsd: Number((rebalanceBudgetUsd / steps).toFixed(4)),
    },
    recommendation: shift > 0.01 ? 'increase-miner-share' : shift < -0.01 ? 'increase-validator-share' : 'hold-mix',
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['allocator/subnet-allocation', subnetAllocation],
  ['allocator/role-allocation', roleAllocation],
  ['allocator/rebalance-plan', rebalancePlan],
]);
