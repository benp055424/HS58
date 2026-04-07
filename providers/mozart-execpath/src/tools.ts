import type {
  ExecpathTaskCompilerInput,
  ExecpathProofBuilderInput,
  ExecpathProgressAuditorInput,
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

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function normalizeEnvironment(env: unknown): 'local' | 'cloud' | 'hybrid' {
  const v = String(env || '').toLowerCase();
  if (v === 'local' || v === 'hybrid') return v;
  return 'cloud';
}

const taskCompiler: ToolHandler = async (raw) => {
  const input = parseInput<ExecpathTaskCompilerInput>(raw);
  const strategyId = String(input?.strategy_id || `exp_${Date.now()}`);
  const targetWeek = Math.max(1, Math.floor(toNumber(input?.target_week, 1)));
  const env = normalizeEnvironment(input?.execution_context?.environment);
  const sourceTasks = Array.isArray(input?.tasks) ? input.tasks : [];

  const compiledTasks = sourceTasks.map((task, idx) => {
    const taskId = String(task?.task_id || `w${targetWeek}_t${idx + 1}`);
    const desc = String(task?.description || 'Unspecified task');
    const artifact = String(task?.expected_output_artifact || 'execution_artifact.json');
    const runtime = clamp(12 + desc.length / 6 + idx * 5, 8, 95);
    const automationPossible = !desc.toLowerCase().includes('manual');
    const baseDir = env === 'cloud' ? '/workspace' : '.';
    return {
      task_id: taskId,
      commands: [
        `echo "start ${taskId}"`,
        `mkdir -p "${baseDir}/artifacts/${taskId}"`,
        `echo '${JSON.stringify({ task_id: taskId, description: desc, target_week: targetWeek })}' > "${baseDir}/artifacts/${taskId}/${artifact}"`,
      ],
      automation_possible: automationPossible,
      estimated_runtime_minutes: Number(runtime.toFixed(1)),
      rollback_commands: [
        `rm -rf "${baseDir}/artifacts/${taskId}"`,
      ],
    };
  });

  return JSON.stringify({
    model: 'execpath/task-compiler',
    strategy_id: strategyId,
    target_week: targetWeek,
    compiled_tasks: compiledTasks,
    generatedAt: new Date().toISOString(),
  });
};

const proofBuilder: ToolHandler = async (raw) => {
  const input = parseInput<ExecpathProofBuilderInput>(raw);
  const strategyId = String(input?.strategy_id || `exp_${Date.now()}`);
  const outputs = Array.isArray(input?.completed_task_outputs) ? input.completed_task_outputs : [];

  const artifacts = outputs.map((output, idx) => {
    const taskId = String(output?.task_id || `task_${idx + 1}`);
    const value = String(output?.value || output?.output || `missing_output_${idx + 1}`);
    const guessedType = value.startsWith('http')
      ? 'url'
      : value.endsWith('.csv')
        ? 'csv'
        : value.endsWith('.json')
          ? 'json'
          : value.startsWith('0x')
            ? 'tx_hash'
            : 'log';
    return {
      type: guessedType,
      value,
      validation_rule: `non_empty_value_for_${taskId}`,
    };
  });

  const completeness = artifacts.length > 0
    ? artifacts.filter((a) => a.value && !a.value.startsWith('missing_output')).length / artifacts.length
    : 0;
  const passFail = completeness >= 0.95 ? 'pass' : completeness >= 0.6 ? 'partial' : 'fail';

  return JSON.stringify({
    model: 'execpath/proof-builder',
    proof_bundle_id: `pb_${Date.now()}`,
    strategy_id: strategyId,
    artifacts,
    pass_fail: passFail,
    generatedAt: new Date().toISOString(),
  });
};

const progressAuditor: ToolHandler = async (raw) => {
  const input = parseInput<ExecpathProgressAuditorInput>(raw);
  const executionLog = Array.isArray(input?.execution_log) ? input.execution_log : [];
  const blocked = executionLog
    .filter((entry) => String(entry?.status || '').toLowerCase() === 'blocked')
    .map((entry) => String(entry?.task_id || entry?.id || 'unknown_task'));

  const completed = executionLog.filter((entry) => {
    const st = String(entry?.status || '').toLowerCase();
    return st === 'done' || st === 'completed' || st === 'pass';
  }).length;

  const total = Math.max(executionLog.length, 1);
  const completion = clamp((completed / total) * 100, 0, 100);
  const currentIncome = toNumber(input?.kpi_snapshot?.current_income_usd, 0);
  const targetIncome = toNumber(input?.kpi_snapshot?.target_income_usd, 0);
  const currentTao = toNumber(input?.kpi_snapshot?.current_tao, 0);
  const targetTao = toNumber(input?.kpi_snapshot?.target_tao, 0);

  return JSON.stringify({
    model: 'execpath/progress-auditor',
    completion_percent: Number(completion.toFixed(2)),
    blocked_tasks: blocked,
    delta_to_goal: {
      income_gap_usd: Number(Math.max(0, targetIncome - currentIncome).toFixed(2)),
      tao_gap: Number(Math.max(0, targetTao - currentTao).toFixed(4)),
    },
    next_best_actions: [
      'unblock highest-impact blocked task first',
      're-run proof-builder for tasks marked partial',
      'increase automation coverage for repeated manual steps',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['execpath/task-compiler', taskCompiler],
  ['execpath/proof-builder', proofBuilder],
  ['execpath/progress-auditor', progressAuditor],
]);
