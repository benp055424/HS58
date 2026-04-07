# Mozart Skill Performance Tracker

Purpose: track Skill Forge publishing outcomes and decide which skills to `scale`, `improve`, or `replace` using repeatable checkpoints.

Created: 2026-04-07 (post initial 15-skill publish)

---

## 1) Baseline snapshots

- Post-publish provider traffic CSV: `analysis/hs58_post_skill_publish_snapshot.csv`
- Post-publish provider traffic markdown: `analysis/hs58_post_skill_publish_snapshot.md`

### Mozart provider baseline (T0)

| Provider | Vouchers | Active Channels | Est Min USDC | Est Max USDC |
|---|---:|---:|---:|---:|
| Mozart-Allocator | 1 | 1 | 0.004000 | 0.008000 |
| Mozart-CompeteOps | 1 | 1 | 0.004000 | 0.008000 |
| Mozart-DelegationOps | 1 | 1 | 0.004000 | 0.008000 |
| Mozart-ProfitOps | 1 | 1 | 0.004000 | 0.008000 |
| Mozart-TreasuryOps | 1 | 1 | 0.004000 | 0.008000 |
| Mozart-UptimeOps | 1 | 1 | 0.004000 | 0.008000 |
| Mozart (orchestra) | 1 | 0 | 0.005000 | 0.010000 |

---

## 2) Published skills registry (Wave 1 + Wave 2 intent)

Status legend:
- `published`
- `scheduled`
- `draft`

Decision legend (set at checkpoints):
- `scale`
- `improve`
- `replace`
- `pending`

| Skill # | Skill Name | Primary Providers/Models | Publish Status | 24h Decision | 72h Decision | Notes |
|---:|---|---|---|---|---|---|
| 1 | Bittensor Revenue Flywheel Launch Pack | (awaiting approved trio) | published | pending | pending | Published by user |
| 2 | Provider to Profit Conversion Builder | (awaiting approved trio) | published | pending | pending | Published by user |
| 3 | Weekly Income Sprint Operator | (awaiting approved trio) | published | pending | pending | Published by user |
| 4 | Evidence-First Growth Auditor | (awaiting approved trio) | published | pending | pending | Published by user |
| 5 | TAO Accumulation Operating System | (awaiting approved trio) | published | pending | pending | Published by user |
| 6 | Bittensor Weekly Ecosystem Revenue Brief | `marketintel/*`, `observability/*`, `profitops/*` | draft | pending | pending | Approved-only path |
| 7 | Subnet Route and Allocation Commander | `subnetpulse/*`, `observability/*`, `allocator/*` | draft | pending | pending | Approved-only path |
| 8 | Launch Readiness and Quality Gate | `catalogops/*`, `qualityops/*`, `governanceops/*` | draft | pending | pending | Approved-only path |
| 9 | Incident Containment and Revenue Recovery | `incidentops/*`, `uptimeops/*`, `profitops/*` | draft | pending | pending | Approved-only path |
| 10 | Delegation and Treasury Growth Operator | `delegationops/*`, `treasuryops/*` | draft | pending | pending | Approved-only path |
| 11 | Provider Competitive Win System | `competeops/*`, `marketintel/*`, `opsguard/*` | draft | pending | pending | Approved-only path |
| 12 | Ops Reliability to Growth Flywheel | `uptimeops/*`, `observability/*`, `growthops/*` | draft | pending | pending | Approved-only path |
| 13 | Capital Guardrail Planner for Providers | `opsguard/*`, `treasuryops/*` | draft | pending | pending | Approved-only path |
| 14 | Marketplace Positioning and Offer Pack | `marketintel/*`, `growthops/*`, `catalogops/*` | draft | pending | pending | Approved-only path |
| 15 | 30-Day Provider Performance Operating Plan | `observability/*`, `profitops/*`, `uptimeops/*`, `treasuryops/*` | draft | pending | pending | Approved-only path |

---

## 3) Checkpoint methodology

Run at:
- `T+24h`
- `T+72h`

For each checkpoint:
1. Capture fresh snapshot:
   - `node scripts/provider-traffic-report.mjs --marketplace-url https://handshake58.com --detect-auth --only-traffic --format csv --output analysis/hs58_snapshot_<timestamp>.csv`
   - `node scripts/provider-traffic-report.mjs --marketplace-url https://handshake58.com --detect-auth --only-traffic --format markdown --output analysis/hs58_snapshot_<timestamp>.md`
2. Compute deltas vs baseline:
   - vouchers delta by Mozart provider
   - active channel delta
3. Map provider deltas back to skill coverage (primary providers per skill)
4. Set decision labels.

---

## 4) Decision thresholds

Use these thresholds as defaults:

- `scale`
  - >= 10 voucher increase attributable to skill-linked providers by 72h
  - and positive active-channel movement
- `improve`
  - some voucher movement but below scale threshold
  - or high reads/probes with weak paid conversion
- `replace`
  - no meaningful movement by 72h
  - or traffic routed to unrelated providers only

If in doubt: mark `improve`, edit prompt for tighter artifact/value language, and re-run for one cycle.

---

## 5) Action log

| Date (UTC) | Action | Result |
|---|---|---|
| 2026-04-07 | Published first 15 skills (user update) | Baseline captured |
| 2026-04-07 | Captured provider baseline snapshot | `analysis/hs58_post_skill_publish_snapshot.*` |

Append all prompt edits, publish events, and checkpoint outcomes here.
