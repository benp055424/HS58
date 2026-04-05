# Mozart Moat Provider Spec Pack

Purpose: define three non-commodity providers that create a durable moat and internal flywheel for HS58 traffic.

Status: implementation-ready blueprint.

---

## 0) Portfolio intent

Current signal:
- HS58 traffic is concentrated in a few providers (Desearch, Webtools, Claude/OpenAI), while Mozart providers show early but thin demand.
- The next wave should increase Mozart share by creating proprietary routing + verification + orchestration layers.

Target outcome:
- Move from "many wrappers" to "agent operating system primitives."
- Capture repeated paid traffic by making Mozart stack the easiest and safest default path.

---

## 1) Provider A: `mozart-routebrain`

### 1.1 What it is
Traffic and route intelligence for agent calls.

Routebrain receives task constraints and returns ranked route plans across providers/models with failover.

### 1.2 Why it is a moat
- Uses private telemetry and reliability priors from your operations.
- Route scoring improves over time and is difficult to replicate externally.

### 1.3 Model IDs
- `routebrain/plan-route`
- `routebrain/failover-route`
- `routebrain/cost-latency-optimizer`

### 1.4 Input schema (all models)
Common envelope:
- `task_type` (string, required): e.g. `"research"`, `"structured_analysis"`, `"api_lookup"`
- `objective` (string, required)
- `constraints` (object, optional)
  - `max_budget_usd` (number)
  - `max_latency_ms` (number)
  - `max_hops` (integer)
  - `required_capabilities` (string[])
- `risk_profile` (string enum, optional): `low|medium|high`
- `context` (object, optional): free-form metadata

Model specifics:
- `plan-route`
  - optional: `preferred_providers` (string[])
- `failover-route`
  - required: `primary_route` (object)
  - optional: `failure_modes` (string[])
- `cost-latency-optimizer`
  - required: `candidate_routes` (object[])

### 1.5 Output schema
- `route_id` (string)
- `recommended` (object)
  - `provider` (string)
  - `model` (string)
  - `estimated_cost_usd` (number)
  - `estimated_latency_ms` (number)
  - `confidence` (number 0-1)
- `alternates` (object[])
- `rationale` (string[])
- `risk_flags` (string[])
- `ttl_seconds` (integer)

### 1.6 Pricing starter
- `plan-route`: $0.006
- `failover-route`: $0.008
- `cost-latency-optimizer`: $0.010

### 1.7 Success KPIs (30 days)
- Routebrain-assisted calls >= 50
- >= 3 Mozart providers with >5 voucher calls each
- +2x aggregate Mozart voucher volume vs baseline snapshot

---

## 2) Provider B: `mozart-execguard`

### 2.1 What it is
Execution assurance middleware for agent outputs.

Execguard validates payload quality and policy compliance before and after action execution.

### 2.2 Why it is a moat
- Verification + rollback guidance produces trust and lowers costly failures.
- Trust layer lock-in is stronger than generation layer lock-in.

### 2.3 Model IDs
- `execguard/preflight`
- `execguard/verify-output`
- `execguard/rollback-plan`

### 2.4 Input schema
Common envelope:
- `operation_type` (string, required)
- `policy_profile` (string, required): e.g. `"production_safe_v1"`
- `input_payload` (object, required)
- `expected_contract` (object, optional): schema/shape expectations

Model specifics:
- `preflight`
  - optional: `dependencies` (string[])
  - optional: `resource_limits` (object)
- `verify-output`
  - required: `output_payload` (object|string)
  - optional: `ground_truth_refs` (string[])
- `rollback-plan`
  - required: `failure_context` (object)
  - optional: `state_snapshot` (object)

### 2.5 Output schema
- `decision` (string enum): `allow|allow_with_warnings|deny`
- `score` (number 0-100)
- `checks` (object[])
  - `name`, `status`, `details`
- `violations` (string[])
- `recommended_actions` (string[])
- `rollback_steps` (string[]) (rollback model only)

### 2.6 Pricing starter
- `preflight`: $0.007
- `verify-output`: $0.009
- `rollback-plan`: $0.011

### 2.7 Success KPIs (30 days)
- >= 25 guarded executions
- Failure/invalid-output rate reduced by >= 30% in guarded flows
- >= 2 integrations where Execguard is called by default before execution

---

## 3) Provider C: `mozart-autopilot`

### 3.1 What it is
Closed-loop operations orchestrator.

Autopilot takes a goal/runbook and executes detect -> decide -> route -> verify -> escalate workflows.

### 3.2 Why it is a moat
- Multi-hop orchestration with state is hard to commoditize.
- Increases internal call-through across your provider graph.

### 3.3 Model IDs
- `autopilot/runbook-execute`
- `autopilot/incident-autoflow`
- `autopilot/revenue-optimizer`

### 3.4 Input schema
Common envelope:
- `goal` (string, required)
- `runbook` (object, required)
  - `steps` (object[])
  - `success_criteria` (string[])
- `operating_limits` (object, optional)
  - `max_budget_usd`
  - `max_duration_ms`
  - `max_retries`
- `escalation_policy` (object, optional)

Model specifics:
- `runbook-execute`
  - optional: `dry_run` (boolean)
- `incident-autoflow`
  - required: `incident_context` (object)
- `revenue-optimizer`
  - required: `traffic_snapshot` (object)
  - optional: `pricing_bounds` (object)

### 3.5 Output schema
- `execution_id` (string)
- `status` (string enum): `completed|partial|failed|escalated`
- `steps_executed` (object[])
- `downstream_calls` (object[])
- `budget_used_usd` (number)
- `outcome_summary` (string)
- `follow_up_actions` (string[])

### 3.6 Pricing starter
- `runbook-execute`: $0.015
- `incident-autoflow`: $0.020
- `revenue-optimizer`: $0.018

### 3.7 Success KPIs (30 days)
- >= 10 recurring channels with autopilot usage
- >= 3 downstream paid calls per autopilot request on average
- >= 20% increase in Mozart internal call-through

---

## 4) Shared implementation requirements

### 4.1 Protocol/API
- OpenAI-compatible `/v1/chat/completions`
- DRAIN voucher-gated paid endpoint
- `/v1/pricing`, `/v1/models`, `/v1/docs`, `/health`
- `/v1/admin/stats`, `/v1/admin/vouchers`, `/v1/admin/claim`

### 4.2 Security
- `ADMIN_PASSWORD` mandatory in production
- strict env-var secret handling
- deny-on-invalid payment headers/signatures

### 4.3 Ops
- structured logs for accepted/rejected payments
- auto-claim enabled
- per-provider SLO tracking: uptime, p95 latency, payment success rate

### 4.4 Data
- store route/verification/orchestration outcomes (non-sensitive summaries) for tuning
- no raw secret payload retention

---

## 5) Launch sequence (90-day)

### Phase 1 (Weeks 1-3): Routebrain
- build + deploy `mozart-routebrain`
- integrate route recommendations into at least 2 existing Mozart flows
- baseline KPI report + first pricing iteration

### Phase 2 (Weeks 4-6): Execguard
- build + deploy `mozart-execguard`
- enforce preflight/verify in Routebrain-routed high-value flows
- publish guardrail runbook

### Phase 3 (Weeks 7-10): Autopilot
- build + deploy `mozart-autopilot`
- launch one production runbook and one incident autoflow
- measure internal call-through multiplier

### Phase 4 (Weeks 11-13): Optimization sprint
- tighten prices from observed conversion
- prune low-signal models
- improve docs for agent discoverability and correct usage

---

## 6) Reporting template (weekly)

- Traffic:
  - top providers by vouchers
  - Mozart share of total paid traffic
- Reliability:
  - uptime, p95 latency, payment reject reasons
- Economics:
  - est min/max earnings per provider
  - model-level price/perf observations
- Decisions:
  - what changed this week
  - what ships next week

---

## 7) Anti-commodity guardrails

Before shipping any new provider, pass all:
- Has proprietary data/logic element? (yes/no)
- Improves workflow outcomes, not just API parity? (yes/no)
- Creates internal routing/flywheel leverage? (yes/no)
- Has measurable KPI target with baseline? (yes/no)

If any answer is no, do not ship.

