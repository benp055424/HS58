# Mozart Income Skill-Combo Spec Pack

Purpose: define three end-to-end money-making providers so agents (or humans) can learn and execute revenue workflows inside the Bittensor ecosystem.

Status: implementation-ready blueprint.

---

## 0) Product intent

Build providers that do all three:
1. teach a concrete earning path,
2. execute or orchestrate actions,
3. return measurable money outcomes and next actions.

If a provider does not produce a money-linked artifact, do not ship it.

---

## 1) Provider A: `mozart-earnpath`

### 1.1 What it is
Personalized earning path generator for Bittensor roles (miner, validator, provider, allocator, operator).

### 1.2 Model IDs
- `earnpath/income-map`
- `earnpath/weekly-plan`
- `earnpath/risk-check`

### 1.3 Pricing starter
- `income-map`: $0.006
- `weekly-plan`: $0.008
- `risk-check`: $0.007

### 1.4 Input schema

Common envelope:
- `profile` (object, required)
  - `role` (string enum, required): `miner|validator|provider|allocator|operator`
  - `experience_level` (string enum, required): `beginner|intermediate|advanced`
  - `hours_per_week` (integer, required, min 1, max 80)
  - `capital_usd` (number, required, min 0)
  - `risk_tolerance` (string enum, required): `low|medium|high`
- `targets` (object, required)
  - `monthly_income_goal_usd` (number, required, min 0)
  - `tao_accumulation_goal` (number, optional, min 0)
  - `time_horizon_days` (integer, required, min 7, max 365)
- `constraints` (object, optional)
  - `region` (string)
  - `compliance_limits` (string[])
  - `tooling_available` (string[])
- `baseline` (object, optional)
  - `current_monthly_income_usd` (number)
  - `current_tao_holdings` (number)

Model-specific additions:
- `income-map`: no additional required fields
- `weekly-plan`: requires `income_map` (object) from prior step
- `risk-check`: requires `proposed_actions` (object[])

### 1.5 Output schema

`income-map`:
- `strategy_id` (string)
- `earning_lanes` (object[])
  - `lane` (string)
  - `expected_monthly_range_usd` (object: `min`, `max`)
  - `time_to_first_revenue_days` (integer)
  - `dependencies` (string[])
  - `key_risks` (string[])
- `recommended_primary_lane` (string)
- `confidence` (number 0-1)

`weekly-plan`:
- `plan_id` (string)
- `weeks` (object[])
  - `week_number` (integer)
  - `actions` (object[])
    - `task_id` (string)
    - `description` (string)
    - `owner` (string enum: `human|agent`)
    - `estimated_hours` (number)
    - `expected_output_artifact` (string)
- `success_metrics` (object[])

`risk-check`:
- `risk_score` (number 0-100)
- `blocking_issues` (string[])
- `recommended_mitigations` (string[])
- `go_no_go` (string enum: `go|conditional|no_go`)

### 1.6 Example request (income-map)
`messages[0].content` JSON:
{
  "profile": {
    "role": "provider",
    "experience_level": "intermediate",
    "hours_per_week": 20,
    "capital_usd": 800,
    "risk_tolerance": "medium"
  },
  "targets": {
    "monthly_income_goal_usd": 1200,
    "tao_accumulation_goal": 3,
    "time_horizon_days": 90
  },
  "baseline": {
    "current_monthly_income_usd": 80,
    "current_tao_holdings": 0.6
  }
}

### 1.7 KPI targets (30 days)
- >= 50 paid calls across all `earnpath/*` models
- >= 20 users/agents progressing from map -> weekly plan
- >= 30% week-2 repeat usage

---

## 2) Provider B: `mozart-execpath`

### 2.1 What it is
Execution layer that converts a plan into command-level tasks and proof artifacts.

### 2.2 Model IDs
- `execpath/task-compiler`
- `execpath/proof-builder`
- `execpath/progress-auditor`

### 2.3 Pricing starter
- `task-compiler`: $0.010
- `proof-builder`: $0.012
- `progress-auditor`: $0.011

### 2.4 Input schema

Common envelope:
- `strategy_id` (string, required)
- `execution_context` (object, required)
  - `environment` (string enum): `local|cloud|hybrid`
  - `wallet_state` (object)
  - `provider_urls` (string[])
- `tasks` (object[], required)
  - `task_id` (string, required)
  - `description` (string, required)
  - `expected_output_artifact` (string, required)

Model-specific additions:
- `task-compiler`:
  - `target_week` (integer, required)
- `proof-builder`:
  - `completed_task_outputs` (object[], required)
- `progress-auditor`:
  - `execution_log` (object[], required)
  - `kpi_snapshot` (object, optional)

### 2.5 Output schema

`task-compiler`:
- `compiled_tasks` (object[])
  - `task_id` (string)
  - `commands` (string[])
  - `automation_possible` (boolean)
  - `estimated_runtime_minutes` (number)
  - `rollback_commands` (string[])

`proof-builder`:
- `proof_bundle_id` (string)
- `artifacts` (object[])
  - `type` (string enum: `log|screenshot|tx_hash|csv|json|url`)
  - `value` (string)
  - `validation_rule` (string)
- `pass_fail` (string enum: `pass|partial|fail`)

`progress-auditor`:
- `completion_percent` (number 0-100)
- `blocked_tasks` (string[])
- `delta_to_goal` (object)
  - `income_gap_usd` (number)
  - `tao_gap` (number)
- `next_best_actions` (string[])

### 2.6 Example request (task-compiler)
{
  "strategy_id": "ep_2026_04_03_01",
  "execution_context": {
    "environment": "cloud",
    "provider_urls": [
      "https://hs58-desearch-production.up.railway.app",
      "https://hs58-production-c9a5.up.railway.app"
    ]
  },
  "tasks": [
    {
      "task_id": "w1_t1",
      "description": "Generate top 25 target providers by demand",
      "expected_output_artifact": "provider_traffic.csv"
    }
  ],
  "target_week": 1
}

### 2.7 KPI targets (30 days)
- >= 25 plans compiled into executable task sets
- >= 60% of compiled plans generate proof bundles
- >= 15 audited plans with measurable gap reduction

---

## 3) Provider C: `mozart-cashflowops`

### 3.1 What it is
Cashflow and reinvestment optimizer for Bittensor income operations.

### 3.2 Model IDs
- `cashflowops/revenue-scoreboard`
- `cashflowops/reinvest-policy`
- `cashflowops/flywheel-tuner`

### 3.3 Pricing starter
- `revenue-scoreboard`: $0.009
- `reinvest-policy`: $0.012
- `flywheel-tuner`: $0.014

### 3.4 Input schema

Common envelope:
- `window_days` (integer, required, min 7, max 180)
- `traffic_data` (object, required)
  - `providers` (object[])
    - `provider` (string)
    - `vouchers` (integer)
    - `active_channels` (integer)
    - `est_earned_min_usd` (number)
    - `est_earned_max_usd` (number)
- `capital_policy` (object, optional)
  - `reserve_ratio` (number 0-1)
  - `reinvest_ratio` (number 0-1)
  - `tao_accumulation_ratio` (number 0-1)

Model-specific additions:
- `revenue-scoreboard`:
  - optional: `segment_labels` (string[])
- `reinvest-policy`:
  - required: `available_capital_usd` (number)
  - required: `risk_budget` (string enum: `low|medium|high`)
- `flywheel-tuner`:
  - required: `current_playbook` (object)
  - optional: `experiment_budget_usd` (number)

### 3.5 Output schema

`revenue-scoreboard`:
- `scoreboard` (object[])
  - `provider` (string)
  - `momentum_score` (number 0-100)
  - `efficiency_score` (number 0-100)
  - `priority` (string enum: `scale|maintain|fix|prune`)
- `portfolio_totals` (object)

`reinvest-policy`:
- `allocation_plan` (object[])
  - `bucket` (string enum: `build|marketing|ops|tao_buy|reserve`)
  - `percent` (number 0-100)
  - `usd_amount` (number)
- `decision_rationale` (string[])

`flywheel-tuner`:
- `experiments` (object[])
  - `experiment_id` (string)
  - `hypothesis` (string)
  - `metric` (string)
  - `guardrail` (string)
  - `duration_days` (integer)
- `expected_lift` (object)

### 3.6 Example request (reinvest-policy)
{
  "window_days": 30,
  "traffic_data": {
    "providers": [
      {
        "provider": "HS58-Desearch",
        "vouchers": 197,
        "active_channels": 12,
        "est_earned_min_usd": 0.044325,
        "est_earned_max_usd": 1.182
      },
      {
        "provider": "Mozart-TreasuryOps",
        "vouchers": 1,
        "active_channels": 1,
        "est_earned_min_usd": 0.004,
        "est_earned_max_usd": 0.008
      }
    ]
  },
  "available_capital_usd": 500,
  "risk_budget": "medium",
  "capital_policy": {
    "reserve_ratio": 0.3,
    "reinvest_ratio": 0.5,
    "tao_accumulation_ratio": 0.2
  }
}

### 3.7 KPI targets (30 days)
- >= 20 cashflow scoreboards generated
- >= 10 reinvest plans produced and tracked
- >= 2 measurable flywheel experiments with positive signal

---

## 4) Shared production requirements

- Implement standard DRAIN provider endpoints:
  - `/v1/pricing`, `/v1/models`, `/v1/docs`, `/health`, `/v1/chat/completions`
  - `/v1/admin/stats`, `/v1/admin/vouchers`, `/v1/admin/claim`
- Require `ADMIN_PASSWORD` in production.
- Log payment accept/reject reason with structured fields.
- Keep outputs deterministic JSON (no prose-only responses).

---

## 5) Launch order and gating

Order:
1. `mozart-earnpath`
2. `mozart-execpath`
3. `mozart-cashflowops`

Gate to move forward:
- Provider N must reach >= 20 paid calls and >= 25% repeat usage before Provider N+1 launch.

---

## 6) Offer framing for HS58 developer

"These are end-to-end money providers, not wrappers. Each one teaches, executes, and measures revenue outcomes. They are designed to create repeat paid traffic and a compounding Bittensor income flywheel."

