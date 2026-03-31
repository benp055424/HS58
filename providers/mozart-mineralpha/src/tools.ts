import type {
  TaskYieldModelInput,
  HardwareRoiInput,
  ThroughputTuningInput,
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

const taskYieldModel: ToolHandler = async (raw) => {
  const input = parseInput<TaskYieldModelInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const role = (input.role || 'miner').toLowerCase() === 'validator' ? 'validator' : 'miner';
  const tasksPerDay = Math.max(1, Math.floor(toNumber(input.tasksPerDay, role === 'validator' ? 8000 : 12000)));
  const successRate = Math.max(0.5, Math.min(1, toNumber(input.successRate, 0.94)));
  const rewardUsdPerKTasks = Math.max(0.0001, toNumber(input.rewardUsdPerKTasks, role === 'validator' ? 0.018 : 0.012));
  const overheadUsdDaily = Math.max(0, toNumber(input.overheadUsdDaily, role === 'validator' ? 22 : 14));

  const effectiveTasks = tasksPerDay * successRate;
  const grossUsd = (effectiveTasks / 1000) * rewardUsdPerKTasks;
  const netUsd = Number(Math.max(0, grossUsd - overheadUsdDaily).toFixed(6));
  const yieldScore = Number(
    Math.min(1, Math.max(0.05, 0.45 * successRate + 0.35 * Math.min(1, grossUsd / Math.max(1, overheadUsdDaily + 1)) + 0.2 * Math.min(1, effectiveTasks / 20000)))
      .toFixed(4)
  );

  return JSON.stringify({
    model: 'mineralpha/task-yield-model',
    subnetId,
    role,
    tasksPerDay,
    successRate: Number(successRate.toFixed(4)),
    rewardUsdPerKTasks: Number(rewardUsdPerKTasks.toFixed(6)),
    overheadUsdDaily: Number(overheadUsdDaily.toFixed(4)),
    effectiveTasksPerDay: Number(effectiveTasks.toFixed(4)),
    projectedGrossUsdDaily: Number(grossUsd.toFixed(6)),
    projectedNetUsdDaily: netUsd,
    taskYieldScore: yieldScore,
    recommendation: netUsd > overheadUsdDaily * 0.15 ? 'maintain-or-scale' : 'reduce-overhead-or-improve-success-rate',
    generatedAt: new Date().toISOString(),
  });
};

const hardwareRoi: ToolHandler = async (raw) => {
  const input = parseInput<HardwareRoiInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const hardwareCostUsd = Math.max(100, toNumber(input.hardwareCostUsd, 4800));
  const powerWatts = Math.max(50, toNumber(input.powerWatts, 420));
  const kwhUsd = Math.max(0.01, toNumber(input.kwhUsd, 0.14));
  const uptime = Math.max(0.5, Math.min(1, toNumber(input.uptime, 0.92)));
  const dailyGrossUsd = Math.max(0, toNumber(input.dailyGrossUsd, 38));
  const horizonDays = Math.max(30, Math.min(730, Math.floor(toNumber(input.horizonDays, 365))));

  const kwhPerDay = (powerWatts / 1000) * 24 * uptime;
  const dailyPowerUsd = kwhPerDay * kwhUsd;
  const dailyNetUsd = Number(Math.max(0, dailyGrossUsd - dailyPowerUsd).toFixed(6));
  const paybackDays = dailyNetUsd > 0 ? Math.ceil(hardwareCostUsd / dailyNetUsd) : null;
  const horizonNetUsd = Number((dailyNetUsd * horizonDays).toFixed(4));
  const roiPct =
    dailyNetUsd > 0
      ? Number((((horizonNetUsd - hardwareCostUsd) / hardwareCostUsd) * 100).toFixed(4))
      : 0;

  return JSON.stringify({
    model: 'mineralpha/hardware-roi',
    subnetId,
    hardwareCostUsd: Number(hardwareCostUsd.toFixed(4)),
    powerWatts: Number(powerWatts.toFixed(4)),
    kwhUsd: Number(kwhUsd.toFixed(4)),
    uptime: Number(uptime.toFixed(4)),
    dailyGrossUsd: Number(dailyGrossUsd.toFixed(6)),
    dailyPowerUsd: Number(dailyPowerUsd.toFixed(6)),
    dailyNetUsd,
    paybackDaysEstimate: paybackDays,
    horizonDays,
    projectedNetUsdHorizon: horizonNetUsd,
    roiPercentHorizon: roiPct,
    recommendation: paybackDays !== null && paybackDays < 240 ? 'hardware-profile-viable' : 'revisit-power-or-revenue-assumptions',
    generatedAt: new Date().toISOString(),
  });
};

const throughputTuning: ToolHandler = async (raw) => {
  const input = parseInput<ThroughputTuningInput>(raw);
  const subnetId = Math.max(0, Math.floor(toNumber(input.subnetId, 13)));
  const currentRps = Math.max(0.1, toNumber(input.currentRps, 42));
  const targetRps = Math.max(currentRps, toNumber(input.targetRps, 72));
  const p99LatencyMs = Math.max(5, toNumber(input.p99LatencyMs, 380));
  const workerCount = Math.max(1, Math.floor(toNumber(input.workerCount, 4)));
  const batchSize = Math.max(1, Math.floor(toNumber(input.batchSize, 32)));

  const headroomRatio = Math.min(2.5, targetRps / currentRps);
  const latencyPressure = Math.min(1, p99LatencyMs / 800);
  const suggestedWorkers = Math.max(
    1,
    Math.ceil(workerCount * headroomRatio * (0.85 + 0.15 * latencyPressure))
  );
  const suggestedBatchSize = Math.max(
    1,
    Math.min(512, Math.round(batchSize * (latencyPressure > 0.55 ? 0.75 : 1.15)))
  );
  const expectedRpsAfter = Number((currentRps * (suggestedWorkers / workerCount) * Math.min(1.25, suggestedBatchSize / batchSize)).toFixed(4));

  return JSON.stringify({
    model: 'mineralpha/throughput-tuning',
    subnetId,
    currentRps: Number(currentRps.toFixed(4)),
    targetRps: Number(targetRps.toFixed(4)),
    p99LatencyMs: Number(p99LatencyMs.toFixed(4)),
    workerCount,
    batchSize,
    suggestedWorkerCount: suggestedWorkers,
    suggestedBatchSize,
    expectedRpsAfterTuning: expectedRpsAfter,
    meetsTarget: expectedRpsAfter >= targetRps * 0.95,
    tuningActions: [
      'coalesce small requests and enforce bounded queues at ingress',
      'pin hot paths and avoid synchronous blocking in the worker loop',
      'scale workers before batch size when p99 latency is elevated',
      'add backpressure when queue depth exceeds 3x steady-state',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['mineralpha/task-yield-model', taskYieldModel],
  ['mineralpha/hardware-roi', hardwareRoi],
  ['mineralpha/throughput-tuning', throughputTuning],
]);
