# V13 First-Window Validation (3-5 Run IDs)

## Goal

Decide quickly whether `agent_v13.py` is truly better than `v12` in live conditions.

This checklist is designed for the first execution window after activation so we can decide:
- **KEEP v13**
- **PATCH for v14 immediately**

without waiting days or guessing.

---

## Required Inputs

Collect **3-5 run IDs** from the first post-activation executions.

For each run ID:
1. `numi fetch-logs`
2. Save output text to a file (one file per run ID), for example:
   - `analysis/v13_logs/run_<uuid>.txt`

---

## What to Measure

We care about four failure modes that killed v12:

1. Weather collapse (`~0.21` concentration)
2. Market over-anchor lock
3. Overuse of fallback/default paths
4. Weak reasoning structure quality

### Pass/Fail Thresholds

For the first 3-5 run IDs:

- **Fallback rate (safe/default/fatal)**  
  - PASS: `< 20%`
  - WARN: `20-35%`
  - FAIL: `> 35%`

- **Weather collapse signature** (`prediction in [0.19, 0.24]`)  
  - PASS: `< 15%` of weather events
  - WARN: `15-30%`
  - FAIL: `> 30%`

- **Over-anchor signature** (predictions tightly hugging market on related routes)  
  - PASS: moderate spread in related-route predictions
  - FAIL: repeated clustering within a narrow band near market across unrelated prompts

- **Reasoning structure completeness**  
  - PASS: `>= 90%` of outputs include section headers:
    - `EVIDENCE_QUALITY:`
    - `ANALYTICAL_RIGOR:`
    - `EVENT_SPECIFICITY:`
    - `INFORMATION_BREADTH:`
    - `EVIDENCE_TO_PROBABILITY_TRANSLATION:`
  - FAIL: `< 80%`

---

## Fast Parser Script

Use:

`python3 scripts/v13_log_eval.py --glob "analysis/v13_logs/*.txt"`

The script prints a compact summary and a traffic-light verdict.

---

## Decision Rule

- **KEEP v13** if:
  - fallback is PASS/WARN (not FAIL),
  - weather-collapse is PASS,
  - reasoning-structure completeness is PASS.

- **PREP v14 immediately** if any FAIL appears.

---

## Notes

- Early emissions can lag; this checklist is for **behavioral quality** first.
- If logs are sparse, keep collecting until you have at least 3 meaningful run IDs.
