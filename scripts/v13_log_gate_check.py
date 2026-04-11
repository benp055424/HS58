#!/usr/bin/env python3
"""
v13_log_gate_check.py

Parse one or more numi fetch-logs outputs (text files) and compute a fast
first-window gate for v13.

The parser is intentionally permissive: it looks for JSON-like agent outputs
and key fallback markers, then computes summary rates.
"""

from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass, field
from typing import Any


RE_EVENT_OUTPUT = re.compile(r'"event_id"\s*:\s*"([^"]+)"', re.IGNORECASE)
RE_PRED = re.compile(r'"prediction"\s*:\s*([0-9]*\.?[0-9]+)', re.IGNORECASE)


@dataclass
class EventRow:
    event_id: str
    prediction: float | None = None
    reasoning: str = ""
    weather_like: bool = False


@dataclass
class GateStats:
    files: list[str] = field(default_factory=list)
    total_events: int = 0
    missing_prediction_count: int = 0
    fallback_count: int = 0
    flatband_count: int = 0
    weather_events: int = 0
    weather_flatband_count: int = 0
    priors_seen: int = 0
    severe_prior_shift_count: int = 0
    events: list[EventRow] = field(default_factory=list)


def parse_reasoning(text: str) -> str:
    hit = re.search(r'"reasoning"\s*:\s*"([^"]*)"', text, flags=re.IGNORECASE)
    return hit.group(1) if hit else ""


def parse_event_chunks(raw: str) -> list[EventRow]:
    rows: list[EventRow] = []
    lines = raw.splitlines()
    for ln in lines:
        if '"event_id"' not in ln:
            continue
        eid_m = RE_EVENT_OUTPUT.search(ln)
        if not eid_m:
            continue
        pred_m = RE_PRED.search(ln)
        pred = float(pred_m.group(1)) if pred_m else None
        reason = parse_reasoning(ln)
        weather_like = "weather" in ln.lower() or "temperature" in ln.lower()
        rows.append(EventRow(event_id=eid_m.group(1), prediction=pred, reasoning=reason, weather_like=weather_like))
    return rows


def parse_prior_shift(reasoning: str) -> float | None:
    hit = re.search(
        r"supervisor_prior\s*=\s*([0-9]*\.?[0-9]+)\s*->\s*posterior\s*=\s*([0-9]*\.?[0-9]+)",
        reasoning,
        flags=re.IGNORECASE,
    )
    if not hit:
        return None
    prior = float(hit.group(1))
    post = float(hit.group(2))
    return abs(post - prior)


def analyze_file(path: str, stats: GateStats) -> None:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        raw = f.read()

    stats.files.append(path)
    rows = parse_event_chunks(raw)
    stats.events.extend(rows)
    stats.total_events += len(rows)

    for row in rows:
        if row.prediction is None:
            stats.missing_prediction_count += 1
            continue

        p = row.prediction
        if row.reasoning:
            low_reason = row.reasoning.lower()
            if any(k in low_reason for k in ("fallback", "fatal_fallback", "model_fallback")):
                stats.fallback_count += 1

            shift = parse_prior_shift(row.reasoning)
            if shift is not None:
                stats.priors_seen += 1
                if shift > 0.28:
                    stats.severe_prior_shift_count += 1

        # Global "dead zone" check for suspicious clustering from bad calibration
        if 0.20 <= p <= 0.24:
            stats.flatband_count += 1

        if row.weather_like:
            stats.weather_events += 1
            if 0.20 <= p <= 0.24:
                stats.weather_flatband_count += 1


def gate_result(stats: GateStats) -> dict[str, Any]:
    total = max(1, stats.total_events)
    missing_rate = stats.missing_prediction_count / total
    fallback_rate = stats.fallback_count / total
    flatband_rate = stats.flatband_count / total
    weather_flat_rate = (
        stats.weather_flatband_count / stats.weather_events if stats.weather_events > 0 else 0.0
    )
    severe_prior_shift_rate = (
        stats.severe_prior_shift_count / stats.priors_seen if stats.priors_seen > 0 else 0.0
    )

    checks = {
        "missing_prediction_rate": {"value": missing_rate, "pass": missing_rate <= 0.02, "threshold": "<= 0.02"},
        "fallback_rate": {"value": fallback_rate, "pass": fallback_rate <= 0.35, "threshold": "<= 0.35"},
        "flatband_rate_0.20_0.24": {"value": flatband_rate, "pass": flatband_rate <= 0.20, "threshold": "<= 0.20"},
        "weather_flatband_rate_0.20_0.24": {
            "value": weather_flat_rate,
            "pass": weather_flat_rate <= 0.25 if stats.weather_events > 0 else True,
            "threshold": "<= 0.25",
        },
        "severe_prior_shift_rate_abs_gt_0.28": {
            "value": severe_prior_shift_rate,
            "pass": severe_prior_shift_rate <= 0.25 if stats.priors_seen > 0 else True,
            "threshold": "<= 0.25",
        },
    }

    pass_count = sum(1 for c in checks.values() if c["pass"])
    overall = "PASS" if pass_count == len(checks) else "FAIL"

    return {
        "overall": overall,
        "checks": checks,
        "summary": {
            "files": stats.files,
            "total_events": stats.total_events,
            "missing_prediction_count": stats.missing_prediction_count,
            "fallback_count": stats.fallback_count,
            "flatband_count": stats.flatband_count,
            "weather_events": stats.weather_events,
            "weather_flatband_count": stats.weather_flatband_count,
            "priors_seen": stats.priors_seen,
            "severe_prior_shift_count": stats.severe_prior_shift_count,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="v13 first-window log gate checker")
    parser.add_argument("logs", nargs="+", help="One or more log text files")
    parser.add_argument("--json-out", default="", help="Optional JSON output path")
    args = parser.parse_args()

    stats = GateStats()
    for path in args.logs:
        if not os.path.exists(path):
            raise FileNotFoundError(f"log not found: {path}")
        analyze_file(path, stats)

    result = gate_result(stats)
    print(json.dumps(result, indent=2))

    if args.json_out:
        os.makedirs(os.path.dirname(args.json_out) or ".", exist_ok=True)
        with open(args.json_out, "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
            f.write("\n")


if __name__ == "__main__":
    main()

