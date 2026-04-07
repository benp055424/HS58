# Mozart Skill Forge: Approved-Only Next Steps

Purpose: keep publishing momentum high while using only currently approved/live providers.

This pack gives:
1. Wave 2 publish-ready prompts (approved providers only)
2. Prompt quality guardrails for Skill Forge
3. A lightweight KPI loop so we scale what converts
4. Promotion gate to switch into `earnpath -> execpath -> cashflowops` once approved

---

## 1) Approved provider set (current working set)

Use only these provider families in Skill Forge prompts for now:
- `launchpadops/*`
- `treasuryops/*`
- `profitops/*`
- `growthops/*`
- `uptimeops/*`
- `observability/*`
- `allocator/*`
- `competeops/*`
- `delegationops/*`
- `catalogops/*`
- `marketintel/*`
- `subnetpulse/*`
- `opsguard/*`

Do NOT reference:
- `earnpath/*`
- `execpath/*`
- `cashflowops/*`

until those providers are approved and visible in marketplace results.

---

## 2) Wave 2 publish-ready skill prompts (approved-only)

### Skill 6 — Bittensor Weekly Ecosystem Revenue Brief
Generate a weekly Bittensor revenue brief: run sector pulse and provider gap analysis, rank top provider routes by demand and reliability, scan revenue opportunities, forecast ROI, and output a prioritized execution playbook for the next 7 days. Output: `weekly_ecosystem_revenue_brief.json`

### Skill 7 — Subnet Route and Allocation Commander
For a target subnet and operator profile: build subnet brief, validator/miner route options, provider ranking, and subnet/role allocation recommendations with explicit rebalance actions and risk flags. Output: `subnet_route_allocation_commander.json`

### Skill 8 — Launch Readiness and Quality Gate
Audit a provider launch candidate end-to-end: profile completeness audit, model coverage gap report, launch readiness score, policy/control matrix check, and release approval recommendation with required fixes. Output: `launch_readiness_quality_gate.json`

### Skill 9 — Incident Containment and Revenue Recovery
Given outage or degradation signals: generate triage brief, fallback simulation plan, recovery runbook, estimate revenue-at-risk, and return a recovery execution sequence ranked by expected revenue protection. Output: `incident_revenue_recovery_pack.json`

### Skill 10 — Delegation Growth and Treasury Balance Plan
For validator growth: build delegator profile, campaign plan, retention playbook, then map expected inflows into runway forecast, cost envelope, and reinvestment plan with explicit budget buckets. Output: `delegation_treasury_balance_plan.json`

### Skill 11 — Provider Competitive Win System
For a target category: generate competitive gap map, win plan, defense plan, provider ranking, and budget-constrained route shortlist with expected upside by action. Output: `competitive_win_system.json`

### Skill 12 — Ops Reliability to Growth Flywheel
Create a reliability-first growth system: provider status check, failure risk score, incident prevention plan, route failover policy, and growth experiments that only activate after uptime guardrails pass. Output: `reliability_growth_flywheel.json`

### Skill 13 — Capital Guardrail Planner for Providers
Build a guardrail policy for provider operators: quote provider cost options, generate budget route + failover plan, project treasury runway under 3 scenarios, and return monthly spending thresholds with stop-loss triggers. Output: `capital_guardrail_planner.json`

### Skill 14 — Marketplace Positioning and Offer Pack
Generate a provider market-intel package: sector pulse, provider gap opportunities, route opportunity map, funnel audit, pricing experiment slate, and retention playbook tuned for paid-call growth. Output: `marketplace_positioning_offer_pack.json`

### Skill 15 — 30-Day Provider Performance Operating Plan
Produce a 30-day operating plan: weekly provider ranking, opportunity scan, ROI forecast, execution playbook, uptime protections, and treasury reinvestment cadence with clear weekly deliverables. Output: `provider_30d_operating_plan.json`

---

## 3) Skill Forge guardrails (copy into your publishing routine)

Before clicking publish, ensure each skill:
- Ends with one explicit artifact filename (`*.json`)
- Has at least one measurable objective (`paid calls`, `ROI`, `runway days`, `uptime risk`, etc.)
- Avoids generic prose outcomes (must produce a structured artifact)
- Uses 4-7 concrete workflow steps
- Does not reference unapproved models/providers

If any skill fails one rule, revise before publish.

---

## 4) KPI loop (lightweight, high signal)

Use this loop every 24h for newly published skills:

1. Track usage/traffic using your provider traffic report:
   - vouchers
   - active channels
   - est min/max earnings
2. Tag each published skill with:
   - publish timestamp
   - linked providers/models
3. After 24h and 72h, classify each skill:
   - `scale` (clear paid-call conversion)
   - `improve` (traffic but weak paid conversion)
   - `replace` (no traction)

Scale threshold suggestion:
- >= 10 paid calls in 72h
- >= 20% repeat usage signal

---

## 5) Promotion gate to Wave 3 (income trio chain)

Switch your flagship prompts to the full chain
`earnpath -> execpath -> proof-builder -> revenue-scoreboard -> reinvest-policy -> flywheel-tuner`
only when:

1. `mozart-earnpath`, `mozart-execpath`, and `mozart-cashflowops` are all approved and online
2. Docs endpoints are healthy and discoverable
3. You can verify successful paid calls on each provider

When these pass, migrate your highest-performing 2-3 approved-only skills first, not all at once.

