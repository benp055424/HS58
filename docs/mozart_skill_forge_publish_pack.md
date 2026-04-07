# Mozart Skill Forge Publish Pack (5 Skills)

Purpose: publish outcome-first skills in Handshake58 Skill Forge that chain your new trio end-to-end:

1. `earnpath/income-map`
2. `execpath/task-compiler`
3. `execpath/proof-builder`
4. `cashflowops/revenue-scoreboard`
5. `cashflowops/reinvest-policy`
6. `cashflowops/flywheel-tuner`

Each definition below is ready to publish with concrete artifacts, measurable KPI deltas, and repeat-use hooks.

---

## Skill 1: Bittensor Revenue Flywheel Launch Pack

**One-line pitch**  
Build a complete 30-day Bittensor money plan with command tasks, proof bundle, and reinvestment + experiment policy.

**Required inputs**
- `profile.role` (`miner|validator|provider|allocator|operator`)
- `profile.experience_level` (`beginner|intermediate|advanced`)
- `profile.hours_per_week` (1-80)
- `profile.capital_usd` (>=0)
- `profile.risk_tolerance` (`low|medium|high`)
- `targets.monthly_income_goal_usd`
- `targets.tao_accumulation_goal` (optional)
- `targets.time_horizon_days` (7-365)
- `execution_context.environment` (`local|cloud|hybrid`)
- `execution_context.provider_urls` (array)
- `available_capital_usd`
- `risk_budget` (`low|medium|high`)

**6-step chain**
1. `earnpath/income-map` -> generate role-fit earning lanes + recommended lane.
2. `execpath/task-compiler` -> convert lane tasks into command-level runbook + rollback commands.
3. `execpath/proof-builder` -> define proof artifacts + validation rules.
4. `cashflowops/revenue-scoreboard` -> score momentum/efficiency and rank what to scale/fix.
5. `cashflowops/reinvest-policy` -> allocate capital across build/marketing/ops/tao_buy/reserve.
6. `cashflowops/flywheel-tuner` -> propose constrained experiments with expected lift.

**Final artifact**
- `revenue_flywheel_launch_pack.json` containing:
  - strategy map
  - compiled command plan
  - proof bundle spec
  - revenue scoreboard
  - reinvest allocation
  - experiment slate

---

## Skill 2: Provider to Profit Conversion Builder

**One-line pitch**  
Turn a provider idea into executable monetization tasks, evidence requirements, and cashflow allocation in one pass.

**Required inputs**
- `profile` and `targets` envelope (same as Skill 1)
- `tasks[]` with:
  - `task_id`
  - `description`
  - `expected_output_artifact`
- `window_days` (7-180)
- `traffic_data.providers[]` with:
  - `provider`
  - `vouchers`
  - `active_channels`
  - `est_earned_min_usd`
  - `est_earned_max_usd`
- `available_capital_usd`
- `risk_budget`

**6-step chain**
1. `earnpath/income-map` -> define best earning lane for provider-led income.
2. `execpath/task-compiler` -> compile growth tasks into deterministic command blocks.
3. `execpath/proof-builder` -> enforce evidence schema per task.
4. `cashflowops/revenue-scoreboard` -> benchmark provider portfolio performance.
5. `cashflowops/reinvest-policy` -> assign capital to highest-yield buckets.
6. `cashflowops/flywheel-tuner` -> create growth experiments tied to paid-call and repeat-use lift.

**Final artifact**
- `provider_profit_conversion_bundle.json` containing:
  - executable task sheet
  - proof checklist
  - reinvest plan
  - 2-4 experiments with metric + guardrail

---

## Skill 3: Weekly Income Sprint Operator

**One-line pitch**  
Generate a weekly execution sprint that moves directly from strategy to commands, evidence, and measurable income gap reduction.

**Required inputs**
- `profile`, `targets`
- `strategy_id` (or auto-generated)
- `target_week` (integer)
- `tasks[]`
- `execution_log[]` (optional for reruns)
- `kpi_snapshot` (optional)
- `traffic_data.providers[]`
- `available_capital_usd`
- `capital_policy` (optional ratios)

**6-step chain**
1. `earnpath/income-map` -> set lane anchor for sprint.
2. `execpath/task-compiler` -> compile this week into run commands + rollback.
3. `execpath/proof-builder` -> produce proof bundle schema for sprint deliverables.
4. `cashflowops/revenue-scoreboard` -> identify scale/maintain/fix/prune priorities.
5. `cashflowops/reinvest-policy` -> produce sprint budget allocation.
6. `cashflowops/flywheel-tuner` -> generate 1-2 sprint experiments with expected lift.

**Final artifact**
- `weekly_income_sprint_pack.json` containing:
  - week command runbook
  - proof-bundle spec
  - sprint budget allocation
  - sprint experiment card

---

## Skill 4: Evidence-First Growth Auditor

**One-line pitch**  
Audit an existing growth plan, convert it into verifiable proof artifacts, and return a capital + experiment plan to close income gaps.

**Required inputs**
- `profile`, `targets`
- `strategy_id`
- `tasks[]`
- `completed_task_outputs[]`
- `execution_log[]`
- `kpi_snapshot`
- `window_days`
- `traffic_data.providers[]`
- `available_capital_usd`
- `risk_budget`

**6-step chain**
1. `earnpath/income-map` -> re-baseline strategic lane confidence.
2. `execpath/task-compiler` -> normalize tasks into executable units.
3. `execpath/proof-builder` -> validate delivered outputs against proof rules.
4. `cashflowops/revenue-scoreboard` -> quantify portfolio momentum + efficiency.
5. `cashflowops/reinvest-policy` -> rebalance capital to close measured gaps.
6. `cashflowops/flywheel-tuner` -> create corrective experiments for weak metrics.

**Final artifact**
- `evidence_first_growth_audit.json` containing:
  - pass/partial/fail proof table
  - completion percent + delta-to-goal
  - reallocation plan
  - corrective experiments with guardrails

---

## Skill 5: TAO Accumulation Operating System

**One-line pitch**  
Build an operating system for consistent TAO accumulation by chaining lane strategy, command execution, proof discipline, and cashflow policy.

**Required inputs**
- `profile`, `targets` (must include `tao_accumulation_goal`)
- `tasks[]`
- `execution_context` (`environment`, `provider_urls`)
- `window_days`
- `traffic_data.providers[]`
- `available_capital_usd`
- `capital_policy.reserve_ratio`
- `capital_policy.reinvest_ratio`
- `capital_policy.tao_accumulation_ratio`
- `risk_budget`

**6-step chain**
1. `earnpath/income-map` -> select lane optimized for TAO accumulation horizon.
2. `execpath/task-compiler` -> convert to deterministic execution commands.
3. `execpath/proof-builder` -> enforce artifact-backed execution.
4. `cashflowops/revenue-scoreboard` -> identify revenue engines to scale.
5. `cashflowops/reinvest-policy` -> allocate capital with explicit tao_buy bucket.
6. `cashflowops/flywheel-tuner` -> define compounding experiments for repeat paid usage.

**Final artifact**
- `tao_accumulation_operating_system.json` containing:
  - lane + command map
  - proof framework
  - tao-weighted capital policy
  - experiment roadmap with expected lift

---

## Suggested publishing tags

Use tags like:
- `bittensor`
- `report`
- `operations`
- `automation`
- `data`
- `profit`

## Suggested default filter mode in Forge

- Protocol: `DRAIN` (or `Mixed` if needed for discovery breadth)
- Skill type: `Specific` for these 5
- Keep prompts explicit about final artifact file names.

