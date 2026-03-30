import type { DelegatorProfileInput, CampaignPlanInput, RetentionPlaybookInput, ToolHandler } from './types.js';

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

const delegatorProfile: ToolHandler = async (raw) => {
  const input = parseInput<DelegatorProfileInput>(raw);
  const subnet = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = input.delegatorRole ?? 'retail';
  const targetStakeTao = Math.max(0, toNumber(input.targetStakeTao, 100));
  const diversificationTarget = clamp(toNumber(input.diversificationTarget, 0.6), 0.1, 1);
  const horizonWeeks = Math.max(1, Math.min(104, Math.floor(toNumber(input.horizonWeeks, 12))));
  const riskTolerance = input.riskTolerance ?? 'medium';

  const riskWeight = riskTolerance === 'high' ? 1.15 : riskTolerance === 'low' ? 0.9 : 1;
  const roleWeight = role === 'institutional' ? 1.1 : role === 'subnet-operator' ? 1.05 : 1;
  const stakeScore = clamp(Math.log10(targetStakeTao + 10) / 4, 0, 1);
  const profileScore = Number(
    clamp(0.35 * stakeScore + 0.35 * diversificationTarget + 0.3 * (1 / riskWeight) * roleWeight, 0, 1).toFixed(4)
  );

  return JSON.stringify({
    model: 'delegationops/delegator-profile',
    subnet,
    delegatorRole: role,
    targetStakeTao: Number(targetStakeTao.toFixed(4)),
    diversificationTarget: Number(diversificationTarget.toFixed(4)),
    horizonWeeks,
    riskTolerance,
    profileScore,
    recommendedAllocation: {
      coreSubnetShare: Number(clamp(0.5 + stakeScore * 0.2 - diversificationTarget * 0.15, 0.2, 0.85).toFixed(4)),
      exploratoryShare: Number(clamp(diversificationTarget * 0.4, 0.05, 0.5).toFixed(4)),
    },
    narrative: [
      'document delegation thesis and rebalancing triggers before scaling stake',
      'separate coldkey operational budget from delegation principal',
      'review validator performance and fee structure on a fixed cadence',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const campaignPlan: ToolHandler = async (raw) => {
  const input = parseInput<CampaignPlanInput>(raw);
  const goal = (input.campaignGoal || 'grow-informed-delegation').slice(0, 200);
  const audience = input.audience ?? 'mixed';
  const durationDays = Math.max(7, Math.min(180, Math.floor(toNumber(input.durationDays, 30))));
  const channels = Array.isArray(input.channels) && input.channels.length
    ? input.channels.map((c) => String(c).slice(0, 64)).slice(0, 8)
    : ['forum', 'discord', 'office-hours'];
  const budgetTao = Math.max(0, toNumber(input.budgetTao, 5));

  const audienceWeight = audience === 'validators' ? 1.12 : audience === 'miners' ? 1.08 : 1;
  const intensity = Number(clamp((budgetTao / 50) * audienceWeight * (durationDays / 60), 0.1, 1).toFixed(4));

  const phases = [
    { name: 'discover', days: Math.max(3, Math.floor(durationDays * 0.2)), focus: 'clarify message and target wallets' },
    { name: 'engage', days: Math.max(5, Math.floor(durationDays * 0.5)), focus: 'host AMAs and publish delegation FAQs' },
    { name: 'convert', days: Math.max(3, Math.floor(durationDays * 0.3)), focus: 'clear stake steps and support routing' },
  ];

  return JSON.stringify({
    model: 'delegationops/campaign-plan',
    campaignGoal: goal,
    audience,
    durationDays,
    channels,
    budgetTao: Number(budgetTao.toFixed(4)),
    intensity,
    phases,
    kpis: [
      { name: 'informed-stakers', target: Number((10 + intensity * 40).toFixed(0)) },
      { name: 'support-tickets-resolved', target: Number((5 + durationDays / 10).toFixed(0)) },
    ],
    generatedAt: new Date().toISOString(),
  });
};

const retentionPlaybook: ToolHandler = async (raw) => {
  const input = parseInput<RetentionPlaybookInput>(raw);
  const segment = input.segment ?? 'active';
  const churnSignals = Array.isArray(input.churnSignals)
    ? input.churnSignals.map((s) => String(s).slice(0, 120)).slice(0, 6)
    : ['silent-wallet', 'missed-governance'];
  const incentiveBudgetTao = Math.max(0, toNumber(input.incentiveBudgetTao, 2));
  const cadence = Math.max(3, Math.min(30, Math.floor(toNumber(input.communicationCadenceDays, 14))));

  const segmentWeight = segment === 'at-risk' ? 1.25 : segment === 'new' ? 1.1 : 1;
  const healthScore = Number(
    clamp(0.72 - churnSignals.length * 0.04 + incentiveBudgetTao * 0.008 * segmentWeight, 0.1, 0.98).toFixed(4)
  );

  return JSON.stringify({
    model: 'delegationops/retention-playbook',
    segment,
    churnSignals,
    incentiveBudgetTao: Number(incentiveBudgetTao.toFixed(4)),
    communicationCadenceDays: cadence,
    healthScore,
    plays: [
      { trigger: 'no-interaction-21d', action: 'send subnet recap + delegate checklist', owner: 'community' },
      { trigger: 'fee-change', action: 'publish diff summary and migration path', owner: 'ops' },
      { trigger: 'governance-vote', action: 'short voter guide with deadlines', owner: 'governance' },
    ],
    incentives: {
      maxRebateBps: Number(clamp(incentiveBudgetTao * 1.5, 0, 50).toFixed(2)),
      matchingNote: 'keep incentives transparent and time-bounded',
    },
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['delegationops/delegator-profile', delegatorProfile],
  ['delegationops/campaign-plan', campaignPlan],
  ['delegationops/retention-playbook', retentionPlaybook],
]);
