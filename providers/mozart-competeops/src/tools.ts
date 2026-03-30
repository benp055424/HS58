import type { GapMapInput, WinPlanInput, DefensePlanInput, ToolHandler } from './types.js';

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

function hash01(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const gapMap: ToolHandler = async (raw) => {
  const input = parseInput<GapMapInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 7)));
  const our = clamp(toNumber(input.ourCapabilityScore, 72), 0, 100);
  const top = clamp(toNumber(input.topCompetitorScore, 81), 0, 100);
  const dims =
    Array.isArray(input.dimensions) && input.dimensions.length > 0
      ? input.dimensions.slice(0, 8).map(String)
      : ['latency', 'reliability', 'model_coverage', 'price', 'support'];
  const horizonWeeks = clamp(Math.floor(toNumber(input.horizonWeeks, 8)), 1, 52);
  const gap = Number((top - our).toFixed(2));

  const rows = dims.map((d, i) => {
    const base = hash01(`${subnetId}:${d}:${horizonWeeks}`);
    const us = clamp(our + (base - 0.5) * 8 + i * 0.4, 0, 100);
    const them = clamp(top + (base - 0.45) * 6, 0, 100);
    return {
      dimension: d,
      ourScore: Number(us.toFixed(2)),
      competitorScore: Number(them.toFixed(2)),
      gap: Number((them - us).toFixed(2)),
    };
  });

  return JSON.stringify({
    model: 'competeops/gap-map',
    subnetId,
    horizonWeeks,
    summary: {
      ourCapabilityScore: our,
      topCompetitorScore: top,
      aggregateGap: gap,
    },
    gapMap: rows,
    priority: gap > 5 ? 'close-largest-gaps-first' : 'maintain-lead',
    generatedAt: new Date().toISOString(),
  });
};

const winPlan: ToolHandler = async (raw) => {
  const input = parseInput<WinPlanInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 7)));
  const objective = (input.objective || 'grow-qualified-traffic').slice(0, 120);
  const resourcesUsd = Math.max(0, toNumber(input.resourcesUsd, 2500));
  const timeframeDays = clamp(Math.floor(toNumber(input.timeframeDays, 30)), 7, 180);
  const risk = input.riskTolerance || 'medium';
  const riskFactor = risk === 'high' ? 1.2 : risk === 'low' ? 0.85 : 1.0;
  const daily = resourcesUsd / Math.max(1, timeframeDays);

  const moveDefs = [
    { name: 'instrument-baseline', effort: 0.2, impact: 0.35 },
    { name: 'narrow-wedge-offer', effort: 0.35, impact: 0.55 },
    { name: 'accelerate-feedback-loop', effort: 0.28, impact: 0.5 },
    { name: 'defend-core-slo', effort: 0.17, impact: 0.62 },
  ];
  const n = moveDefs.length;
  const moves = moveDefs.map((m, i) => {
    const score = (m.impact * riskFactor) / Math.max(0.12, m.effort) + hash01(`${subnetId}:${m.name}`) * 0.08;
    return {
      rank: i + 1,
      move: m.name,
      score: Number(score.toFixed(4)),
      suggestedSpendUsd: Number(((resourcesUsd * (0.18 + i * 0.07)) / n).toFixed(2)),
    };
  });
  moves.sort((a, b) => b.score - a.score);
  moves.forEach((m, i) => {
    m.rank = i + 1;
  });

  return JSON.stringify({
    model: 'competeops/win-plan',
    subnetId,
    objective,
    resourcesUsd: Number(resourcesUsd.toFixed(4)),
    timeframeDays,
    riskTolerance: risk,
    winPlan: {
      moves,
      impliedDailyBudgetUsd: Number(daily.toFixed(4)),
    },
    recommendation: moves[0]?.move || 'instrument-baseline',
    generatedAt: new Date().toISOString(),
  });
};

const defensePlan: ToolHandler = async (raw) => {
  const input = parseInput<DefensePlanInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 7)));
  const threats = Array.isArray(input.threats) && input.threats.length > 0
    ? input.threats.slice(0, 6).map((t) => String(t).slice(0, 80))
    : ['price-undercut', 'latency-regression', 'model-churn'];
  const moat = clamp(toNumber(input.currentMoatScore, 0.62), 0, 1);
  const budgetUsd = Math.max(0, toNumber(input.budgetUsd, 1200));
  const sla = clamp(toNumber(input.slaTargetUptime, 0.995), 0.9, 0.9999);

  const actions = threats.map((t, i) => {
    const severity = clamp(0.35 + hash01(`${subnetId}:${t}`) * 0.5 + (1 - moat) * 0.15, 0, 1);
    const allocation = Number(((budgetUsd * severity) / threats.length).toFixed(2));
    return {
      threat: t,
      severity: Number(severity.toFixed(4)),
      allocationUsd: allocation,
      mitigations: [
        'add synthetic checks + canaries on hot paths',
        'pin dependency versions and staged rollouts',
        'document rollback and comms owner per threat class',
      ].slice(0, 2 + (i % 2)),
    };
  });

  return JSON.stringify({
    model: 'competeops/defense-plan',
    subnetId,
    currentMoatScore: Number(moat.toFixed(4)),
    slaTargetUptime: Number(sla.toFixed(6)),
    budgetUsd: Number(budgetUsd.toFixed(4)),
    defensePlan: {
      threats: actions,
      moatReinforcement: [
        'narrow public api surface and enforce auth on admin routes',
        'cache stable reads; isolate noisy workloads',
        'publish uptime + latency budgets tied to slaTargetUptime',
      ],
    },
    recommendation: moat < 0.55 ? 'invest-in-moat-before-scale' : 'maintain-guardrails',
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['competeops/gap-map', gapMap],
  ['competeops/win-plan', winPlan],
  ['competeops/defense-plan', defensePlan],
]);
