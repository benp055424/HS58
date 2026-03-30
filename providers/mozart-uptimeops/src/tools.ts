import type { FailureRiskInput, IncidentPreventionInput, RecoveryRunbookInput, ToolHandler } from './types.js';

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

const failureRisk: ToolHandler = async (raw) => {
  const input = parseInput<FailureRiskInput>(raw);
  const serviceName = (input.serviceName || 'subnet-service').slice(0, 120);
  const monthlyDowntimeMinutes = Math.max(0, toNumber(input.monthlyDowntimeMinutes, 45));
  const errorRate = clamp(toNumber(input.errorRate, 0.002), 0, 1);
  const dependencyCount = Math.max(0, Math.floor(toNumber(input.dependencyCount, 6)));
  const criticalPathDepth = Math.max(1, Math.floor(toNumber(input.criticalPathDepth, 4)));

  const downtimeScore = clamp(monthlyDowntimeMinutes / 240, 0, 1);
  const errorScore = clamp(errorRate * 80, 0, 1);
  const depScore = clamp(dependencyCount / 20, 0, 1);
  const pathScore = clamp((criticalPathDepth - 1) / 10, 0, 1);
  const riskIndex = Number(
    clamp(0.32 * downtimeScore + 0.28 * errorScore + 0.22 * depScore + 0.18 * pathScore, 0, 1).toFixed(4)
  );

  return JSON.stringify({
    model: 'uptimeops/failure-risk',
    serviceName,
    monthlyDowntimeMinutes: Number(monthlyDowntimeMinutes.toFixed(4)),
    errorRate: Number(errorRate.toFixed(6)),
    dependencyCount,
    criticalPathDepth,
    riskIndex,
    tier: riskIndex < 0.35 ? 'low' : riskIndex < 0.65 ? 'medium' : 'high',
    mitigations: [
      'add synthetic checks on critical dependencies',
      'reduce blast radius with bulkheads and feature flags',
      'tighten error budgets and paging for top consumer paths',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const incidentPrevention: ToolHandler = async (raw) => {
  const input = parseInput<IncidentPreventionInput>(raw);
  const components = Array.isArray(input.components) && input.components.length
    ? input.components.map((c) => String(c).slice(0, 64)).slice(0, 12)
    : ['api', 'worker', 'indexer', 'rpc-bridge'];
  const mtbfHours = Math.max(1, toNumber(input.mtbfHours, 720));
  const changeRatePerWeek = Math.max(0, toNumber(input.changeRatePerWeek, 4));
  const monitoringCoverage = clamp(toNumber(input.monitoringCoverage, 0.75), 0, 1);

  const changeStress = clamp(changeRatePerWeek / 12, 0, 1);
  const reliability = clamp(1 - 200 / mtbfHours + monitoringCoverage * 0.15 - changeStress * 0.2, 0, 1);
  const preventionScore = Number(clamp(reliability, 0.05, 0.99).toFixed(4));

  return JSON.stringify({
    model: 'uptimeops/incident-prevention',
    components,
    mtbfHours: Number(mtbfHours.toFixed(4)),
    changeRatePerWeek: Number(changeRatePerWeek.toFixed(4)),
    monitoringCoverage: Number(monitoringCoverage.toFixed(4)),
    preventionScore,
    guardrails: [
      { name: 'change-freeze-windows', detail: 'block risky deploys during emissions peaks' },
      { name: 'canary-percentage', detail: 'roll forward with capped traffic and auto-rollback' },
      { name: 'ownership-map', detail: 'every component has a 15-minute escalation path' },
    ],
    generatedAt: new Date().toISOString(),
  });
};

const recoveryRunbook: ToolHandler = async (raw) => {
  const input = parseInput<RecoveryRunbookInput>(raw);
  const systemName = (input.systemName || 'validator-stack').slice(0, 120);
  const rtoMinutes = Math.max(1, Math.floor(toNumber(input.rtoMinutes, 30)));
  const rpoMinutes = Math.max(0, Math.floor(toNumber(input.rpoMinutes, 5)));
  const lastDrillDaysAgo = Math.max(0, Math.floor(toNumber(input.lastDrillDaysAgo, 21)));

  const drillPenalty = clamp(lastDrillDaysAgo / 90, 0, 1);
  const readiness = Number(
    clamp(0.88 - drillPenalty * 0.25 + (60 / (rtoMinutes + 30)) * 0.12, 0.1, 0.98).toFixed(4)
  );

  const steps = [
    { order: 1, action: 'page owner and freeze risky deploys', slaMinutes: Math.max(5, Math.floor(rtoMinutes * 0.15)) },
    { order: 2, action: 'fail over to warm standby or reduce traffic', slaMinutes: Math.floor(rtoMinutes * 0.35) },
    { order: 3, action: 'restore from backup if data loss exceeds RPO', slaMinutes: Math.max(rpoMinutes, Math.floor(rtoMinutes * 0.25)) },
    { order: 4, action: 'verify invariants and re-enable traffic gradually', slaMinutes: Math.floor(rtoMinutes * 0.25) },
  ];

  return JSON.stringify({
    model: 'uptimeops/recovery-runbook',
    systemName,
    rtoMinutes,
    rpoMinutes,
    lastDrillDaysAgo,
    readiness,
    steps,
    comms: {
      statusChannel: '#incidents',
      customerMessageTemplate: 'We are investigating elevated errors; next update within 15 minutes.',
    },
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['uptimeops/failure-risk', failureRisk],
  ['uptimeops/incident-prevention', incidentPrevention],
  ['uptimeops/recovery-runbook', recoveryRunbook],
]);
