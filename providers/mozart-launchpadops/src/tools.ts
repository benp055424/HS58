import type { MinerGoLiveInput, ValidatorGoLiveInput, First30DaysInput, ToolHandler } from './types.js';

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

function bool(v: unknown, fallback: boolean): boolean {
  if (typeof v === 'boolean') return v;
  return fallback;
}

const minerGoLive: ToolHandler = async (raw) => {
  const input = parseInput<MinerGoLiveInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));

  const checks = [
    { id: 'wallet_ready', label: 'Cold/hot wallet funded and keys secured', pass: bool(input.walletReady, true) },
    { id: 'axon_port', label: 'Axon port reachable from expected peers', pass: bool(input.axonPortOpen, true) },
    { id: 'registration', label: 'Subnet registration + metagraph sync OK', pass: bool(input.registrationComplete, false) },
    { id: 'deps', label: 'Runtime/deps match subnet release', pass: bool(input.depsInstalled, true) },
    { id: 'smoke', label: 'End-to-end smoke test (register → forward → reward path)', pass: bool(input.smokeTestPass, false) },
  ];

  const passed = checks.filter((c) => c.pass).length;
  const score = Number((passed / checks.length).toFixed(4));
  const status = score >= 0.85 ? 'go-live-ready' : score >= 0.55 ? 'needs-work' : 'blocked';

  return JSON.stringify({
    model: 'launchpadops/miner-go-live',
    subnetId,
    goLiveScore: score,
    status,
    checklist: checks,
    nextSteps: [
      'close any failing checklist items before pointing production traffic',
      'snapshot config + versions in a single runbook entry',
      'set alerts for registration drift and axon reachability',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const validatorGoLive: ToolHandler = async (raw) => {
  const input = parseInput<ValidatorGoLiveInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));

  const checks = [
    { id: 'stake', label: 'Stake and balance cover fees + slashing buffer', pass: bool(input.stakeReady, true) },
    { id: 'hotkey', label: 'Hotkey registered with correct subnet', pass: bool(input.hotkeyRegistered, false) },
    { id: 'rpc', label: 'RPC endpoints healthy with failover', pass: bool(input.rpcEndpointsOk, true) },
    { id: 'weights', label: 'Weights commit path tested on non-prod', pass: bool(input.weightsCommitOk, false) },
    { id: 'failover', label: 'Failover + incident runbook assigned', pass: bool(input.failoverPlanReady, false) },
  ];

  const passed = checks.filter((c) => c.pass).length;
  const score = Number((passed / checks.length).toFixed(4));
  const status = score >= 0.85 ? 'go-live-ready' : score >= 0.55 ? 'needs-work' : 'blocked';

  return JSON.stringify({
    model: 'launchpadops/validator-go-live',
    subnetId,
    goLiveScore: score,
    status,
    checklist: checks,
    nextSteps: [
      'rehearse weights commit with dry-run + rollback owner',
      'verify stake buffer against worst-case fee spikes',
      'document RPC failover and paging expectations',
    ],
    generatedAt: new Date().toISOString(),
  });
};

const first30Days: ToolHandler = async (raw) => {
  const input = parseInput<First30DaysInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const startEpoch = Math.max(0, Math.floor(toNumber(input.startEpoch, 1000)));
  const timezone = input.timezone || 'UTC';

  const milestones = [
    { day: 1, focus: 'baseline metrics, alerts, and log shipping', tasks: ['confirm reward path', 'freeze config'] },
    { day: 3, focus: 'compare emissions vs expectation', tasks: ['tune batching', 'review peer connectivity'] },
    { day: 7, focus: 'first weekly review', tasks: ['cost vs budget', 'incident log empty or triaged'] },
    { day: 14, focus: 'capacity headroom', tasks: ['load test hot path', 'review key rotation plan'] },
    { day: 30, focus: 'stabilize + scale decision', tasks: ['SLO sign-off', 'next-quarter runway check'] },
  ].map((m) => ({
    ...m,
    roleHint: role === 'validator' ? 'emphasize weights cadence and stake health' : 'emphasize axon stability and peer diversity',
  }));

  return JSON.stringify({
    model: 'launchpadops/first-30-days',
    subnetId,
    role,
    startEpoch,
    timezone,
    milestones,
    cadence: {
      dailyStandupMinutes: 10,
      weeklyReviewMinutes: 45,
    },
    risks: [
      'reward variance vs expectation',
      'unexpected registration or peer churn',
      'infra drift between staging and prod',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['launchpadops/miner-go-live', minerGoLive],
  ['launchpadops/validator-go-live', validatorGoLive],
  ['launchpadops/first-30-days', first30Days],
]);
