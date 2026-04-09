# Numinous Similarity + Reasoning Scoring Watch

## Why

You asked for continuous awareness of anti-copy enforcement and scoring changes so our miner stays unique and emissions-competitive.

This playbook adds two guardrails:

1. **Policy Watch** — detect updates in Numinous docs/changelog and keyword-signaled policy shifts.
2. **Uniqueness Audit** — measure lexical overlap of our agent against known winner code and local references.

---

## 1) Policy Watch

Script: `scripts/numinous-policy-watch.mjs`

What it does:
- Pulls and fingerprints:
  - `CHANGELOG.md`
  - `docs/subnet-rules.md`
  - `docs/gateway-guide.md`
- Scans for watch keywords:
  - `similarity`, `copycat`, `copied`, `plagiarism`, `reasoning`, `scoring layer`, `llm as judge`, `brier`
- Compares to previous run and writes snapshots + an alert summary.

Usage:

- One-shot snapshot:
  - `node scripts/numinous-policy-watch.mjs`
- Custom output directory:
  - `node scripts/numinous-policy-watch.mjs --out-dir analysis/numinous_policy_watch`
- Custom keywords:
  - `node scripts/numinous-policy-watch.mjs --keywords "similarity,plagiarism,reasoning,scoring layer"`

Outputs:
- `analysis/numinous_policy_watch/latest.json`
- `analysis/numinous_policy_watch/latest.md`
- `analysis/numinous_policy_watch/snapshot-<timestamp>.json`

---

## 2) Agent Uniqueness Audit

Script: `scripts/agent-uniqueness-audit.mjs`

What it does:
- Normalizes code and computes token n-gram overlap (Jaccard) against a comparison set.
- Emits sorted top matches and a red/yellow/green grade per comparison file.

Default reference set:
- `analysis/numinous_top10/*.py`

Usage:

- Audit `agent_v12.py`:
  - `node scripts/agent-uniqueness-audit.mjs --candidate agent_v12.py`
- Compare against local agent versions:
  - `node scripts/agent-uniqueness-audit.mjs --candidate agent_v12.py --compare-glob "agent_v*.py"`
- Write JSON report artifact:
  - `node scripts/agent-uniqueness-audit.mjs --candidate agent_v12.py --report analysis/agent_uniqueness_v12.json`

Output:
- Console summary + optional JSON report file (`--report`).

Recommended gate before upload:
- **No individual comparison file with overlap >= 0.62** (RED threshold by default).
- If overlap is high:
  - Refactor control flow and function decomposition.
  - Rewrite reasoning structure/evidence synthesis blocks.
  - Re-run audit until max overlap drops below threshold.

---

## Daily Operating Loop (fast)

1. `node scripts/numinous-policy-watch.mjs`
2. If alert mentions similarity/scoring-rule changes, review `latest.md` immediately.
3. Before each upload candidate:
   - `node scripts/agent-uniqueness-audit.mjs --candidate <candidate.py> --report analysis/agent_uniqueness_<candidate>.json`
4. If overlap is high, revise and re-audit.

