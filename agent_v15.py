"""
Numinous SN6 miner agent v13.

Design goals:
- Raise accuracy under sparse/noisy evidence while preserving reasoning quality.
- Adapt to reasoning-first scoring with source-backed rationales.
- Keep runtime reliable inside the 240s sandbox window.
- Route to exact/near-exact Polymarket context when available.
- Use optional Signals/Unusual Whales evidence when accessible.
- Preserve conservative calibration and bounded outputs.
"""

import asyncio
import json
import math
import os
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import httpx


BASE_URL = os.getenv("SANDBOX_PROXY_URL", "http://sandbox_proxy").rstrip("/")
RUN_ID = os.getenv("RUN_ID") or "local-test-run"

URL_OPENROUTER_CHAT = f"{BASE_URL}/api/gateway/openrouter/chat/completions"
URL_CHUTES_CHAT = f"{BASE_URL}/api/gateway/chutes/chat/completions"
URL_DESEARCH_SEARCH = f"{BASE_URL}/api/gateway/desearch/ai/search"
URL_DESEARCH_CRAWL = f"{BASE_URL}/api/gateway/desearch/web/crawl"
URL_INDICIA = f"{BASE_URL}/api/gateway/numinous-indicia"
URL_NUMINOUS_SIGNALS = f"{BASE_URL}/api/gateway/numinous-signals"
URL_UNUSUAL_WHALES = f"{BASE_URL}/api/gateway/unusual-whales"

POLYMARKET_BASE = "https://gamma-api.polymarket.com"

MODEL_GROK = "x-ai/grok-4.1"
MODEL_CHUTES = "Qwen/Qwen3-235B-A22B-Instruct-2507"
MODEL_CHUTES_FALLBACK = "openai/gpt-oss-120b"

TIME_BUDGET_SECONDS = 210.0
SAFE_DEFAULT = 0.50
PRED_MIN = 0.01
PRED_MAX = 0.99

RETRIABLE_CODES = {429, 500, 502, 503}
WEATHER_COEFS = None
PRIOR_WEIGHT_BASE = {"exact": 0.02, "related": 0.10, "fallback": 0.12}
PRIOR_WEIGHT_BOOST_CAP = {"exact": 0.04, "related": 0.12, "fallback": 0.16}
ENABLE_NUMINOUS_SIGNALS = str(os.getenv("ENABLE_NUMINOUS_SIGNALS", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
}
ENABLE_UNUSUAL_WHALES = str(os.getenv("ENABLE_UNUSUAL_WHALES", "0")).strip().lower() in {
    "1",
    "true",
    "yes",
}
MIN_REASONING_EVIDENCE_BUDGET = 26.0


@dataclass
class MarketMatch:
    question: str
    description: str
    yes_price: float
    similarity: float
    exact: bool


@dataclass
class MatchResult:
    status: str  # EXACT, RELATED, NO_MARKETS
    exact_match: MarketMatch | None
    related_match: MarketMatch | None
    context: str | None


@dataclass
class EvidenceBundle:
    lines: list[str]
    sources: list[str]
    notes: list[str]


class Budget:
    def __init__(self, seconds: float):
        self._deadline = time.time() + seconds

    def remaining(self) -> float:
        return max(0.0, self._deadline - time.time())

    def has(self, reserve: float) -> bool:
        return self.remaining() > reserve


def clamp(v: float, lo: float = PRED_MIN, hi: float = PRED_MAX) -> float:
    return max(lo, min(hi, float(v)))


def clamp01(v: float) -> float:
    return max(0.0, min(1.0, float(v)))


def sigmoid(x: float) -> float:
    x = max(-60.0, min(60.0, x))
    return 1.0 / (1.0 + math.exp(-x))


def parse_probability(text: str) -> float | None:
    if not text:
        return None
    text = text.strip()

    # Primary parse: explicit line format.
    line = re.search(r"^PREDICTION:\s*([0-9]*\.?[0-9]+)\s*$", text, flags=re.I | re.M)
    if line:
        raw = float(line.group(1))
        return clamp(raw / 100.0 if raw > 1.2 else raw)

    # JSON parse.
    for candidate in (text, extract_json_block(text)):
        if not candidate:
            continue
        try:
            obj = json.loads(candidate)
        except Exception:
            continue
        for key in ("prediction", "probability", "forecast", "likelihood", "p"):
            value = obj.get(key)
            if value is None:
                continue
            try:
                raw = float(value)
                return clamp(raw / 100.0 if raw > 1.2 else raw)
            except Exception:
                continue

    # Label parse fallback.
    label = re.search(
        r"(prediction|probability|forecast|likelihood)\s*[:=]\s*([0-9]*\.?[0-9]+)",
        text,
        flags=re.IGNORECASE,
    )
    if label:
        raw = float(label.group(2))
        return clamp(raw / 100.0 if raw > 1.2 else raw)

    pct = re.search(r"\b([0-9]{1,3}(?:\.[0-9]+)?)\s*%", text)
    if pct:
        return clamp(float(pct.group(1)) / 100.0)

    dec = re.search(r"\b(0\.[0-9]{2,4})\b", text)
    if dec:
        return clamp(float(dec.group(1)))

    return None


def extract_json_block(text: str) -> str | None:
    fenced = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text)
    if fenced:
        return fenced.group(1)
    l = text.find("{")
    r = text.rfind("}")
    if l >= 0 and r > l:
        return text[l : r + 1]
    return None


def normalize_text(text: str) -> str:
    cleaned = re.sub(r"[^\w\s]", "", (text or "").lower().strip())
    return re.sub(r"\s+", " ", cleaned)


def keyword_query(title: str, max_terms: int = 8) -> str:
    stop = {
        "will",
        "the",
        "a",
        "an",
        "in",
        "on",
        "of",
        "to",
        "and",
        "or",
        "by",
        "for",
        "be",
        "is",
        "it",
    }
    words = re.findall(r"[A-Za-z0-9]+", title.lower())
    filtered = [w for w in words if w not in stop and len(w) > 1]
    return " ".join(filtered[:max_terms]) or title[:60]


def jaccard(a: str, b: str) -> float:
    sa = set(re.findall(r"[a-z0-9]+", (a or "").lower()))
    sb = set(re.findall(r"[a-z0-9]+", (b or "").lower()))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def parse_yes_price(market: dict[str, Any]) -> float | None:
    prices = market.get("outcomePrices")
    if prices is not None:
        try:
            arr = json.loads(prices) if isinstance(prices, str) else prices
            if isinstance(arr, list) and arr:
                value = float(arr[0])
                if 0.0 <= value <= 1.0:
                    return value
        except Exception:
            pass

    for token in market.get("tokens") or []:
        if str(token.get("outcome", "")).upper() == "YES":
            try:
                value = float(token.get("price"))
                if 0.0 <= value <= 1.0:
                    return value
            except Exception:
                pass
    return None


def parse_scheduled_date(text: str) -> str | None:
    if not text:
        return None

    iso = re.search(r"scheduled for (\d{4}-\d{2}-\d{2})", text, flags=re.IGNORECASE)
    if iso:
        return iso.group(1)

    natural = re.search(
        r"scheduled for ([A-Za-z]+)\s+([0-9]{1,2})(?:,\s*([0-9]{4}))?",
        text,
        flags=re.IGNORECASE,
    )
    if not natural:
        return None

    month_map = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }

    month = month_map.get(natural.group(1).lower())
    if month is None:
        return None
    day = int(natural.group(2))
    year = int(natural.group(3) or datetime.utcnow().year)
    try:
        return datetime(year, month, day).date().isoformat()
    except Exception:
        return None


def date_compatible(event_date: str | None, market_desc: str) -> bool:
    market_date = parse_scheduled_date(market_desc or "")
    if not event_date or not market_date:
        return True
    return event_date == market_date


def classify_domain(event_data: dict[str, Any]) -> str:
    title = str(event_data.get("title", "")).lower()
    desc = str(event_data.get("description", "")).lower()
    merged = f"{title} {desc}"
    meta = event_data.get("metadata") or {}
    topics = [str(t).lower() for t in (meta.get("topics") or [])] if isinstance(meta, dict) else []

    if "weather" in topics or " temperature " in merged:
        return "weather"
    if "app store" in topics or " app store " in f" {merged} ":
        return "app_store"
    if any(k in merged for k in ("strike", "missile", "drone", "iran", "israel", "ukraine", "war")):
        return "geopolitics"
    if any(k in merged for k in ("bitcoin", "ethereum", "crypto", "price of")):
        return "crypto"
    if "sports" in topics or " vs " in merged or " win?" in merged:
        return "sports"
    return "general"


def post_calibrate(prob: float, domain: str) -> float:
    # Weather-specific transform disabled (stale coefficients were collapsing probabilities).
    # Keep outputs market-faithful across all domains.
    return clamp(prob)


def as_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        raw = float(value)
    except Exception:
        return None
    if raw > 1.2:
        raw = raw / 100.0
    if not math.isfinite(raw):
        return None
    return clamp(raw)


def parse_metadata(event_data: dict[str, Any]) -> dict[str, Any]:
    meta = event_data.get("metadata")
    if isinstance(meta, dict):
        return meta
    if isinstance(meta, str):
        try:
            parsed = json.loads(meta)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def extract_supervisor_prior(event_data: dict[str, Any]) -> float | None:
    candidates = [
        event_data.get("community_prediction_lr"),
        event_data.get("community_prediction"),
        event_data.get("prior"),
        event_data.get("supervisor_prior"),
    ]
    meta = parse_metadata(event_data)
    for key in ("community_prediction_lr", "community_prediction", "prior", "supervisor_prior"):
        candidates.append(meta.get(key))

    for value in candidates:
        parsed = as_float(value)
        if parsed is not None:
            return parsed
    return None


def evidence_strength_score(evidence: EvidenceBundle) -> float:
    if evidence is None:
        return 0.0

    src_score = 0.0
    for src in evidence.sources:
        s = str(src or "").lower()
        if "numinous-signals" in s:
            src_score += 0.22
        elif "numinous-indicia" in s:
            src_score += 0.18
        elif "unusual-whales" in s:
            src_score += 0.12
        elif "polymarket" in s:
            src_score += 0.12
        else:
            src_score += 0.07

    line_score = min(0.25, 0.04 * len(evidence.lines))
    unavailable_hits = 0
    for note in evidence.notes:
        note_l = str(note or "").lower()
        if any(k in note_l for k in ("unavailable", "no_match", "missing", "skipped_budget")):
            unavailable_hits += 1
    penalty = min(0.25, 0.05 * unavailable_hits)
    return clamp01(src_score + line_score - penalty)


def reliability_guard(
    posterior: float,
    *,
    mode: str,
    domain: str,
    related: MarketMatch | None,
    prior: float | None,
    evidence_strength: float,
) -> float:
    out = clamp(posterior)

    if related is not None:
        if related.similarity >= 0.90:
            leash = 0.10 if evidence_strength < 0.45 else 0.14
        elif related.similarity >= 0.75:
            leash = 0.14 if evidence_strength < 0.45 else 0.20
        else:
            leash = 0.18 if evidence_strength < 0.45 else 0.26

        if domain == "geopolitics":
            leash += 0.04
        if mode == "fallback":
            leash -= 0.02

        leash = max(0.08, leash)
        low = max(PRED_MIN, related.yes_price - leash)
        high = min(PRED_MAX, related.yes_price + leash)
        out = max(low, min(high, out))
    elif prior is not None and evidence_strength < 0.35:
        # When evidence is weak and no market anchor exists, avoid exploratory tails.
        out = clamp(0.65 * prior + 0.35 * out)

    return clamp(out)


def translate_with_prior(
    posterior: float, prior: float | None, mode: str, evidence_strength: float
) -> float:
    if prior is None:
        return clamp(posterior)
    base = PRIOR_WEIGHT_BASE.get(mode, PRIOR_WEIGHT_BASE["related"])
    boost_cap = PRIOR_WEIGHT_BOOST_CAP.get(mode, PRIOR_WEIGHT_BOOST_CAP["related"])
    weak_evidence_boost = (1.0 - clamp01(evidence_strength)) * boost_cap
    prior_weight = min(0.30, base + weak_evidence_boost)
    return clamp((1.0 - prior_weight) * posterior + prior_weight * prior)


def compact_text(text: str, limit: int = 260) -> str:
    flat = re.sub(r"\s+", " ", (text or "").strip())
    return flat[:limit]


def parse_reasoning_text(llm_text: str) -> str:
    if not llm_text:
        return ""
    hit = re.search(r"REASONING:\s*(.+)$", llm_text, flags=re.I | re.S)
    if hit:
        return compact_text(hit.group(1), limit=420)
    lines = [ln.strip() for ln in llm_text.splitlines() if ln.strip()]
    joined = " ".join(lines[:5])
    return compact_text(joined, limit=420)


def infer_tickers(title: str, description: str, limit: int = 2) -> list[str]:
    text = f"{title} {description}"
    blocked = {"WILL", "THE", "THIS", "THAT", "WITH", "FROM", "AND", "FOR", "YES", "NOT"}
    out: list[str] = []
    for token in re.findall(r"\b[A-Z]{2,5}\b", text):
        if token in blocked or token in out:
            continue
        out.append(token)
        if len(out) >= limit:
            break
    if not out and "bitcoin" in text.lower():
        out.append("BTC")
    if not out and "ethereum" in text.lower():
        out.append("ETH")
    return out


def first_topic(event_data: dict[str, Any], domain: str) -> str:
    meta = parse_metadata(event_data)
    topics = meta.get("topics")
    if isinstance(topics, list):
        for topic in topics:
            t = str(topic).strip().lower()
            if t:
                return t
    if domain in ("geopolitics", "crypto", "sports", "weather"):
        return domain
    return "geopolitics"


def minimal_evidence(match: MarketMatch | None, note: str) -> EvidenceBundle:
    lines: list[str] = []
    if match is not None:
        lines.append(
            f"Market context: yes_price={match.yes_price:.3f}, "
            f"similarity={match.similarity:.2f}, exact={str(match.exact).lower()}"
        )
    return EvidenceBundle(lines=lines, sources=["polymarket"], notes=[note])


def render_reasoning(
    *,
    mode: str,
    event_title: str,
    domain: str,
    prediction: float,
    supervisor_prior: float | None,
    match: MarketMatch | None,
    evidence: EvidenceBundle,
    llm_reasoning: str,
) -> str:
    evidence_strength = evidence_strength_score(evidence)
    lines: list[str] = []
    lines.append("EVIDENCE_QUALITY:")
    if evidence.lines:
        for line in evidence.lines[:4]:
            lines.append(f"- {line}")
    else:
        lines.append("- Sparse external evidence; leaned on market structure and conservative bounds.")

    lines.append("ANALYTICAL_RIGOR:")
    if match is not None:
        lines.append(
            f"- Market anchor considered: yes_price={match.yes_price:.3f}, similarity={match.similarity:.2f}, exact={str(match.exact).lower()}."
        )
    lines.append(f"- Forecast mode={mode}, domain={domain}, bounded to [{PRED_MIN:.2f}, {PRED_MAX:.2f}].")
    lines.append(f"- Evidence strength score={evidence_strength:.2f} (higher => less prior anchoring).")
    if llm_reasoning:
        lines.append(f"- Model rationale summary: {llm_reasoning}")

    lines.append("EVENT_SPECIFICITY:")
    lines.append(f"- Event: {compact_text(event_title, 180)}")
    if match is not None:
        lines.append(f"- Closest market question: {compact_text(match.question, 170)}")

    lines.append("INFORMATION_BREADTH:")
    if evidence.sources:
        lines.append(f"- Sources used: {', '.join(evidence.sources[:8])}.")
    else:
        lines.append("- Sources used: polymarket market structure and internal fallback logic.")
    for note in evidence.notes[:3]:
        lines.append(f"- {note}")

    lines.append("EVIDENCE_TO_PROBABILITY_TRANSLATION:")
    if supervisor_prior is None:
        lines.append(f"- No supervisor prior provided; posterior={prediction:.3f} derived from evidence/market blend.")
    else:
        delta = prediction - supervisor_prior
        lines.append(
            f"- supervisor_prior={supervisor_prior:.3f} -> posterior={prediction:.3f} (shift={delta:+.3f}) after evidence weighting."
        )

    return "\n".join(lines)[:1800]


async def async_retry(fn, retries: int = 3, delay: float = 1.1):
    for attempt in range(retries):
        try:
            return await fn()
        except httpx.HTTPStatusError as err:
            if err.response.status_code not in RETRIABLE_CODES or attempt == retries - 1:
                raise
            await asyncio.sleep(delay * (attempt + 1))
        except httpx.TimeoutException:
            if attempt == retries - 1:
                raise
            await asyncio.sleep(delay * (attempt + 1))


async def crawl_json(client: httpx.AsyncClient, url: str, budget: Budget) -> dict | None:
    if not budget.has(6):
        return None

    async def _call():
        resp = await client.post(
            URL_DESEARCH_CRAWL,
            json={"url": url, "run_id": RUN_ID},
            timeout=min(20.0, max(6.0, budget.remaining() - 1)),
        )
        resp.raise_for_status()
        payload = resp.json()
        content = payload.get("content", "")
        if not content:
            return None
        if isinstance(content, str):
            return json.loads(content)
        if isinstance(content, dict):
            return content
        return None

    try:
        return await async_retry(_call, retries=2, delay=1.0)
    except Exception:
        return None


async def find_general_match(
    client: httpx.AsyncClient, title: str, description: str, budget: Budget
) -> MarketMatch | None:
    wanted = normalize_text(title)
    event_date = parse_scheduled_date(description)
    best: MarketMatch | None = None
    best_score = -1.0
    queries = [
        keyword_query(title),
        title[:80],
        f"Polymarket {keyword_query(title)}",
    ]
    seen_questions: set[str] = set()

    for query in queries:
        data = await crawl_json(client, f"{POLYMARKET_BASE}/public-search?q={query}", budget)
        if not data:
            continue
        for event in data.get("events") or []:
            for market in event.get("markets") or []:
                question = str(market.get("question", ""))
                if not question or question in seen_questions:
                    continue
                seen_questions.add(question)

                yes_price = parse_yes_price(market)
                if yes_price is None:
                    continue
                desc = str(market.get("description", ""))

                norm_q = normalize_text(question)
                sim = jaccard(title, question)
                exact = norm_q == wanted or sim >= 0.985
                if sim < 0.35 and not exact:
                    continue

                score = sim + (0.3 if exact else 0.0)
                if event_date:
                    if date_compatible(event_date, desc):
                        score += 0.08
                    else:
                        score -= 0.10

                if score > best_score:
                    best_score = score
                    best = MarketMatch(
                        question=question,
                        description=desc,
                        yes_price=clamp(yes_price),
                        similarity=sim,
                        exact=exact,
                    )
    return best


async def find_btts_match(
    client: httpx.AsyncClient, title: str, description: str, budget: Budget
) -> MarketMatch | None:
    hit = re.match(r"^(.+?)\s+vs\.\s+(.+?):\s*Both Teams to Score$", title)
    if not hit:
        return None

    team_a, team_b = hit.group(1).strip(), hit.group(2).strip()
    queries = [f"{team_a} {team_b}", f"{team_b} {team_a}"]
    wanted = normalize_text(title)
    alt = normalize_text(f"{team_b} vs. {team_a}: Both Teams to Score")
    event_date = parse_scheduled_date(description)

    for q in queries:
        data = await crawl_json(client, f"{POLYMARKET_BASE}/public-search?q={q}", budget)
        if not data:
            continue
        for event in data.get("events") or []:
            for market in event.get("markets") or []:
                question = str(market.get("question", ""))
                if "Both Teams to Score" not in question:
                    continue
                norm_q = normalize_text(question)
                if norm_q not in (wanted, alt):
                    continue
                yes_price = parse_yes_price(market)
                if yes_price is None:
                    continue
                desc = str(market.get("description", ""))
                if not date_compatible(event_date, desc):
                    continue
                return MarketMatch(
                    question=question,
                    description=desc,
                    yes_price=clamp(yes_price),
                    similarity=max(jaccard(title, question), 0.995),
                    exact=True,
                )
    return None


def parse_app_rank_title(title: str) -> dict[str, Any] | None:
    hit = re.search(
        r"Will (.+?) be (?:the )?#(\d+) (Free|Paid) [Aa]pp in the US "
        r"(?:iPhone |Apple )?App Store on (\w+ \d+)",
        title,
        flags=re.I,
    )
    if not hit:
        return None
    app, rank, kind, date_str = hit.groups()
    months = {
        "january": 1,
        "february": 2,
        "march": 3,
        "april": 4,
        "may": 5,
        "june": 6,
        "july": 7,
        "august": 8,
        "september": 9,
        "october": 10,
        "november": 11,
        "december": 12,
    }
    parts = date_str.split()
    month = months.get(parts[0].lower()) if len(parts) == 2 else None
    if month is None:
        return None
    try:
        day = int(parts[1])
        date_iso = datetime(datetime.utcnow().year, month, day).date().isoformat()
    except Exception:
        return None
    return {
        "app": app.strip(),
        "rank": int(rank),
        "kind": kind.capitalize(),
        "date_iso": date_iso,
        "date_str": date_str,
    }


async def find_appstore_related(
    client: httpx.AsyncClient, title: str, budget: Budget
) -> tuple[MarketMatch | None, str | None]:
    parsed = parse_app_rank_title(title)
    if parsed is None:
        return None, None

    app = parsed["app"]
    rank = parsed["rank"]
    kind = parsed["kind"]
    date_iso = parsed["date_iso"]

    queries = [f"{app} {kind} App Store", f"{kind} App Store #{rank}"]
    candidates: list[MarketMatch] = []
    lines: list[str] = [
        f'App Store event: "{app}" rank #{rank} ({kind}) on {parsed["date_str"]}.',
    ]

    for q in queries:
        data = await crawl_json(client, f"{POLYMARKET_BASE}/public-search?q={q}", budget)
        if not data:
            continue
        for event in data.get("events") or []:
            for market in event.get("markets") or []:
                qn = str(market.get("question", ""))
                yes_price = parse_yes_price(market)
                if yes_price is None:
                    continue
                sim = jaccard(title, qn)
                if sim < 0.30 and app.lower() not in qn.lower():
                    continue
                desc = str(market.get("description", ""))
                m = MarketMatch(
                    question=qn,
                    description=desc,
                    yes_price=clamp(yes_price),
                    similarity=sim,
                    exact=(normalize_text(qn) == normalize_text(title)),
                )
                candidates.append(m)

    if not candidates:
        return None, "\n".join(lines + ["No Polymarket app-store candidates found."])

    candidates.sort(key=lambda m: (m.exact, m.similarity, m.yes_price), reverse=True)
    exact = next((c for c in candidates if c.exact), None)
    if exact is not None:
        return exact, None

    top = candidates[:6]
    lines.append("Related Polymarket markets:")
    for c in top:
        date_note = parse_scheduled_date(c.description) or "unknown-date"
        date_hint = "date-match" if date_note == date_iso else date_note
        lines.append(f"- {c.question} | yes={c.yes_price:.3f} | sim={c.similarity:.2f} | {date_hint}")
    return top[0], "\n".join(lines)


async def route_market_match(
    client: httpx.AsyncClient, title: str, description: str, budget: Budget
) -> MatchResult:
    btts = await find_btts_match(client, title, description, budget)
    if btts is not None:
        return MatchResult(status="EXACT", exact_match=btts, related_match=None, context=None)

    app_related, app_ctx = await find_appstore_related(client, title, budget)
    if app_related is not None and app_related.exact:
        return MatchResult(status="EXACT", exact_match=app_related, related_match=None, context=None)
    if app_related is not None and app_ctx:
        return MatchResult(status="RELATED", exact_match=None, related_match=app_related, context=app_ctx)

    general = await find_general_match(client, title, description, budget)
    if general is None:
        return MatchResult(status="NO_MARKETS", exact_match=None, related_match=None, context=None)
    if general.exact or general.similarity >= 0.93:
        return MatchResult(status="EXACT", exact_match=general, related_match=None, context=None)
    return MatchResult(status="RELATED", exact_match=None, related_match=general, context=None)


async def openrouter_chat(
    client: httpx.AsyncClient,
    messages: list[dict[str, Any]],
    model: str = MODEL_GROK,
    max_tokens: int = 1600,
    use_web_plugin: bool = False,
    timeout_s: float = 85.0,
) -> str | None:
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": 0.0,
        "max_tokens": max_tokens,
        "run_id": RUN_ID,
    }
    if use_web_plugin:
        payload["plugins"] = [{"id": "web", "engine": "native", "max_results": 3}]

    async def _call():
        resp = await client.post(URL_OPENROUTER_CHAT, json=payload, timeout=timeout_s)
        resp.raise_for_status()
        return resp.json()

    try:
        data = await async_retry(_call, retries=3, delay=1.2)
        choices = data.get("choices") or []
        return choices[0].get("message", {}).get("content", "") if choices else ""
    except Exception:
        return None


async def chutes_chat(client: httpx.AsyncClient, prompt: str, budget: Budget) -> float | None:
    for model in (MODEL_CHUTES, MODEL_CHUTES_FALLBACK):
        if not budget.has(10):
            return None
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": 300,
            "temperature": 0.1,
            "run_id": RUN_ID,
        }
        try:
            resp = await client.post(
                URL_CHUTES_CHAT,
                json=payload,
                timeout=min(40.0, max(12.0, budget.remaining() - 1)),
            )
            resp.raise_for_status()
            content = ((resp.json().get("choices") or [{}])[0].get("message") or {}).get("content", "")
            prob = parse_probability(content)
            if prob is not None:
                return prob
        except Exception:
            continue
    return None


async def desearch_query(client: httpx.AsyncClient, query: str, budget: Budget) -> list[dict[str, Any]]:
    if not budget.has(6):
        return []
    try:
        resp = await client.post(
            URL_DESEARCH_SEARCH,
            json={
                "prompt": query,
                "model": "NOVA",
                "tools": ["web", "twitter", "reddit"],
                "date_filter": "PAST_WEEK",
                "count": 10,
                "run_id": RUN_ID,
            },
            timeout=min(20.0, max(6.0, budget.remaining() - 1)),
        )
        resp.raise_for_status()
        data = resp.json()
        rows: list[dict[str, Any]] = []

        for key in ("search_results", "wikipedia_search_results", "youtube_search_results"):
            value = data.get(key)
            if isinstance(value, list):
                rows.extend(value)

        for key in ("tweets", "reddit_search", "hacker_news_search", "arxiv_search"):
            value = data.get(key)
            if isinstance(value, list):
                rows.extend(value)

        if rows:
            return rows

        # Backward-compat fallback for older payload shapes.
        return data.get("results", []) or data.get("data", []) or []
    except Exception:
        return []


async def get_indicia_summary(client: httpx.AsyncClient, title: str, budget: Budget) -> str:
    lower = title.lower()
    if not any(k in lower for k in ("strike", "missile", "drone", "iran", "israel", "ukraine", "war")):
        return ""
    if not budget.has(10):
        return ""

    signals: list[str] = []
    for endpoint in ("/x-osint", "/liveuamap"):
        if not budget.has(5):
            break
        try:
            resp = await client.post(
                URL_INDICIA + endpoint,
                json={"run_id": RUN_ID, "limit": 8},
                timeout=min(14.0, max(6.0, budget.remaining() - 1)),
            )
            resp.raise_for_status()
            for sig in (resp.json().get("signals") or [])[:6]:
                msg = str(sig.get("signal", "")).strip()
                if msg:
                    signals.append(msg[:180])
        except Exception:
            continue
    return " | ".join(signals[:8])


async def run_grok_research(
    client: httpx.AsyncClient,
    title: str,
    description: str,
    cutoff: str,
    market_hint: str,
    indicia_hint: str,
    budget: Budget,
) -> tuple[float, str] | None:
    if not budget.has(35):
        return None
    system = (
        "You are an expert forecaster for prediction markets.\n"
        "Use web plugin once, anchor to market price when relevant, and avoid overconfidence.\n"
        "Output format:\n"
        "PREDICTION: <number from 0.01 to 0.99>\n"
        "REASONING: <3-5 concise sentences>"
    )
    user = (
        f"Event title: {title}\n"
        f"Event description: {description}\n"
        f"Cutoff: {cutoff}\n"
        f"Market hint: {market_hint}\n"
        f"Geo OSINT hint: {indicia_hint or 'none'}\n"
    )
    text = await openrouter_chat(
        client,
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=MODEL_GROK,
        max_tokens=2200,
        use_web_plugin=True,
        timeout_s=min(95.0, max(25.0, budget.remaining() - 1)),
    )
    if not text:
        return None
    prob = parse_probability(text)
    if prob is None:
        return None
    return prob, text[:1800]


async def run_appstore_llm(
    client: httpx.AsyncClient, title: str, description: str, cutoff: str, context: str, budget: Budget
) -> tuple[float, str] | None:
    if not budget.has(22):
        return None
    system = (
        "You are an expert forecaster for app-store ranking events.\n"
        "Use provided market context as primary anchor.\n"
        "Output format:\n"
        "PREDICTION: <number from 0.01 to 0.99>\n"
        "REASONING: <brief rationale>"
    )
    user = (
        f"Event title: {title}\n"
        f"Event description: {description}\n"
        f"Cutoff: {cutoff}\n\n"
        f"Market context:\n{context}"
    )
    text = await openrouter_chat(
        client,
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=MODEL_GROK,
        max_tokens=1200,
        use_web_plugin=False,
        timeout_s=min(50.0, max(16.0, budget.remaining() - 1)),
    )
    if not text:
        return None
    prob = parse_probability(text)
    if prob is None:
        return None
    return prob, text[:1400]


async def run_desearch_fallback(
    client: httpx.AsyncClient, title: str, description: str, cutoff: str, budget: Budget
) -> tuple[float, str] | None:
    if not budget.has(18):
        return None
    queries = [
        f"Polymarket {title[:80]}",
        title[:80],
        f"{title[:60]} latest news",
    ]
    snippets: list[str] = []
    for q in queries[:3]:
        results = await desearch_query(client, q, budget)
        for row in results[:3]:
            snippets.append(f"[{row.get('url', 'source')}] {row.get('title', '')}: {row.get('snippet', '')[:240]}")
    context = "\n".join(snippets) if snippets else "No external findings."
    prompt = (
        f"Event: {title}\nDescription: {description}\nCutoff: {cutoff}\n"
        f"Evidence:\n{context}\n\n"
        "Return strict JSON only: {\"prediction\": 0.XX, \"reasoning\": \"...\"}"
    )
    prob = await chutes_chat(client, prompt, budget)
    if prob is None:
        return None
    return prob, "fallback_desearch_chutes"


async def fetch_causal_drivers(
    client: httpx.AsyncClient, event_data: dict[str, Any], domain: str, budget: Budget
) -> tuple[list[str], list[str]]:
    if not budget.has(8):
        return [], ["signals:causal_drivers_skipped_budget"]
    event_id = str(event_data.get("event_id", "")).strip()
    if not event_id:
        return [], ["signals:causal_drivers_missing_event_id"]
    payload = {
        "run_id": RUN_ID,
        "event_id": event_id,
        "topic": first_topic(event_data, domain),
    }
    notes: list[str] = []
    lines: list[str] = []
    try:
        resp = await client.post(
            f"{URL_NUMINOUS_SIGNALS}/causal-drivers/drivers",
            json=payload,
            timeout=min(20.0, max(6.0, budget.remaining() - 1)),
        )
        resp.raise_for_status()
        data = resp.json()
        drivers = data.get("drivers") or []
        drives = data.get("drives") or []
        for row in drivers[:3]:
            lines.append(
                f"Causal driver: {compact_text(str(row.get('title', 'unknown')), 120)} "
                f"({row.get('direction', 'n/a')}, {row.get('strength', 'n/a')})"
            )
        for row in drives[:2]:
            lines.append(
                f"Downstream implication: {compact_text(str(row.get('title', 'unknown')), 120)} "
                f"({row.get('direction', 'n/a')}, {row.get('strength', 'n/a')})"
            )
        if not lines:
            notes.append("signals:causal_drivers_no_links")
        else:
            notes.append("signals:causal_drivers_used")
    except Exception:
        notes.append("signals:causal_drivers_unavailable")
    return lines, notes


async def fetch_deep_research(
    client: httpx.AsyncClient, event_data: dict[str, Any], domain: str, budget: Budget
) -> tuple[list[str], list[str]]:
    if not budget.has(8):
        return [], ["signals:deep_research_skipped_budget"]
    payload: dict[str, Any] = {"run_id": RUN_ID}
    event_id = str(event_data.get("event_id", "")).strip()
    if event_id:
        payload["event_id"] = event_id
    else:
        payload["title"] = str(event_data.get("title", ""))[:180]
        payload["topics"] = [first_topic(event_data, domain)]
    lines: list[str] = []
    notes: list[str] = []
    try:
        resp = await client.post(
            f"{URL_NUMINOUS_SIGNALS}/deep-research/report",
            json=payload,
            timeout=min(20.0, max(6.0, budget.remaining() - 1)),
        )
        resp.raise_for_status()
        data = resp.json()
        matched_via = str(data.get("matched_via", "none"))
        if matched_via != "none":
            storyline = compact_text(str(data.get("storyline_name", "unknown storyline")), 120)
            focus = compact_text(str(data.get("research_focus", "")), 190)
            report = compact_text(str(data.get("report", "")), 210)
            lines.append(f"Deep research storyline: {storyline} (matched_via={matched_via})")
            if focus:
                lines.append(f"Deep research focus: {focus}")
            if report:
                lines.append(f"Deep research excerpt: {report}")
            notes.append("signals:deep_research_used")
        else:
            notes.append("signals:deep_research_no_match")
    except Exception:
        notes.append("signals:deep_research_unavailable")
    return lines, notes


async def fetch_unusual_whales(
    client: httpx.AsyncClient, title: str, description: str, budget: Budget
) -> tuple[list[str], list[str]]:
    if not budget.has(8):
        return [], ["unusual_whales:skipped_budget"]
    tickers = infer_tickers(title, description, limit=2)
    lines: list[str] = []
    notes: list[str] = []
    for ticker in tickers:
        if not budget.has(5):
            break
        payload = {"run_id": RUN_ID, "ticker": ticker, "major_only": True, "limit": 4, "page": 0}
        try:
            resp = await client.post(
                f"{URL_UNUSUAL_WHALES}/news/headlines",
                json=payload,
                timeout=min(16.0, max(6.0, budget.remaining() - 1)),
            )
            resp.raise_for_status()
            data = resp.json()
            headlines = data.get("headlines") or []
            for h in headlines[:2]:
                text = compact_text(str(h.get("headline", "")), 140)
                if not text:
                    continue
                source = compact_text(str(h.get("source", "unknown")), 20)
                sentiment = str(h.get("sentiment", "n/a"))
                lines.append(f"UnusualWhales {ticker}: {text} [{source}, sentiment={sentiment}]")
            if headlines:
                notes.append(f"unusual_whales:{ticker}_used")
        except Exception:
            notes.append(f"unusual_whales:{ticker}_unavailable")
    if not lines and not notes:
        notes.append("unusual_whales:no_tickers")
    return lines, notes


async def build_reasoning_evidence(
    client: httpx.AsyncClient,
    event_data: dict[str, Any],
    domain: str,
    title: str,
    description: str,
    budget: Budget,
) -> EvidenceBundle:
    lines: list[str] = []
    sources: list[str] = ["polymarket"]
    notes: list[str] = []

    if ENABLE_NUMINOUS_SIGNALS and domain in ("geopolitics", "crypto", "sports", "general"):
        causal_lines, causal_notes = await fetch_causal_drivers(client, event_data, domain, budget)
        if causal_lines:
            lines.extend(causal_lines)
            sources.append("numinous-signals/causal-drivers")
        notes.extend(causal_notes)

        deep_lines, deep_notes = await fetch_deep_research(client, event_data, domain, budget)
        if deep_lines:
            lines.extend(deep_lines)
            sources.append("numinous-signals/deep-research")
        notes.extend(deep_notes)
    elif domain in ("geopolitics", "crypto", "sports", "general"):
        notes.append("signals:disabled")

    if ENABLE_UNUSUAL_WHALES and domain in ("crypto", "general"):
        uw_lines, uw_notes = await fetch_unusual_whales(client, title, description, budget)
        if uw_lines:
            lines.extend(uw_lines)
            sources.append("unusual-whales/headlines")
        notes.extend(uw_notes)
    elif domain in ("crypto", "general"):
        notes.append("unusual_whales:disabled")

    if domain == "geopolitics":
        indicia_text = await get_indicia_summary(client, title, budget)
        if indicia_text:
            lines.append(f"Indicia OSINT summary: {compact_text(indicia_text, 220)}")
            sources.append("numinous-indicia")
            notes.append("indicia:used")

    unique_sources: list[str] = []
    for src in sources:
        if src not in unique_sources:
            unique_sources.append(src)
    return EvidenceBundle(lines=lines[:8], sources=unique_sources[:8], notes=notes[:8])


async def collect_reasoning_evidence(
    client: httpx.AsyncClient,
    event_data: dict[str, Any],
    domain: str,
    title: str,
    description: str,
    budget: Budget,
    match: MarketMatch | None,
) -> EvidenceBundle:
    if not budget.has(MIN_REASONING_EVIDENCE_BUDGET):
        return minimal_evidence(match, "evidence:skipped_budget")

    evidence = await build_reasoning_evidence(client, event_data, domain, title, description, budget)
    if match is not None and not evidence.lines:
        evidence.lines.append(
            f"Market context: yes_price={match.yes_price:.3f}, similarity={match.similarity:.2f}"
        )
    return evidence


def blend_with_market(domain: str, llm_pred: float, related: MarketMatch | None) -> float:
    if related is None:
        return llm_pred
    if related.similarity >= 0.88:
        w_market = 0.62 if domain in ("sports", "crypto", "app_store") else 0.56
    elif related.similarity >= 0.72:
        w_market = 0.50
    else:
        w_market = 0.38
    blended = w_market * related.yes_price + (1.0 - w_market) * llm_pred
    # Do not hard-clamp here; reliability_guard applies route-aware leashes later.
    return clamp(blended)


async def forecast(event_data: dict[str, Any]) -> dict[str, Any]:
    budget = Budget(TIME_BUDGET_SECONDS)
    event_id = str(event_data.get("event_id", "unknown"))
    title = str(event_data.get("title", "")).strip()
    description = str(event_data.get("description", "")).strip()
    cutoff = str(event_data.get("cutoff", ""))
    supervisor_prior = extract_supervisor_prior(event_data)

    if not title:
        return {"event_id": event_id, "prediction": SAFE_DEFAULT, "reasoning": "empty_title_fallback"}

    domain = classify_domain(event_data)

    timeout_cfg = httpx.Timeout(35.0)
    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        match = await route_market_match(client, title, description, budget)
        related = match.related_match

        # Exact market route.
        if match.status == "EXACT" and match.exact_match is not None:
            raw = match.exact_match.yes_price
            posterior = post_calibrate(raw, domain if domain == "weather" else "exact")
            evidence = minimal_evidence(match.exact_match, "evidence:exact_market_only")
            evidence_strength = evidence_strength_score(evidence)
            guarded = reliability_guard(
                posterior,
                mode="exact",
                domain=domain,
                related=match.exact_match,
                prior=supervisor_prior,
                evidence_strength=evidence_strength,
            )
            pred = translate_with_prior(guarded, supervisor_prior, "exact", evidence_strength)
            reasoning = render_reasoning(
                mode="exact_market",
                event_title=title,
                domain=domain,
                prediction=pred,
                supervisor_prior=supervisor_prior,
                match=match.exact_match,
                evidence=evidence,
                llm_reasoning="Exact market match used as dominant evidence.",
            )
            return {"event_id": event_id, "prediction": pred, "reasoning": reasoning}

        # App-store related route with structured context.
        if domain == "app_store" and match.context:
            app_out = await run_appstore_llm(client, title, description, cutoff, match.context, budget)
            if app_out is not None:
                blended = blend_with_market(domain, app_out[0], match.related_match)
                posterior = post_calibrate(blended, domain)
                evidence = await collect_reasoning_evidence(
                    client, event_data, domain, title, description, budget, match.related_match
                )
                evidence_strength = evidence_strength_score(evidence)
                guarded = reliability_guard(
                    posterior,
                    mode="related",
                    domain=domain,
                    related=match.related_match,
                    prior=supervisor_prior,
                    evidence_strength=evidence_strength,
                )
                pred = translate_with_prior(guarded, supervisor_prior, "related", evidence_strength)
                reasoning = render_reasoning(
                    mode="app_store_related",
                    event_title=title,
                    domain=domain,
                    prediction=pred,
                    supervisor_prior=supervisor_prior,
                    match=match.related_match,
                    evidence=evidence,
                    llm_reasoning=parse_reasoning_text(app_out[1]),
                )
                return {"event_id": event_id, "prediction": pred, "reasoning": reasoning}

        # Grok research path with web plugin.
        market_hint = "none"
        if related is not None:
            market_hint = (
                f"yes_price={related.yes_price:.3f}, sim={related.similarity:.2f}, "
                f"question={related.question[:120]}"
            )
        indicia = await get_indicia_summary(client, title, budget)
        grok_out = await run_grok_research(client, title, description, cutoff, market_hint, indicia, budget)
        if grok_out is not None:
            blended = blend_with_market(domain, grok_out[0], related)
            posterior = post_calibrate(blended, domain)
            evidence = await collect_reasoning_evidence(
                client, event_data, domain, title, description, budget, related
            )
            evidence_strength = evidence_strength_score(evidence)
            guarded = reliability_guard(
                posterior,
                mode="related",
                domain=domain,
                related=related,
                prior=supervisor_prior,
                evidence_strength=evidence_strength,
            )
            pred = translate_with_prior(guarded, supervisor_prior, "related", evidence_strength)
            reasoning = render_reasoning(
                mode="grok_research",
                event_title=title,
                domain=domain,
                prediction=pred,
                supervisor_prior=supervisor_prior,
                match=related,
                evidence=evidence,
                llm_reasoning=parse_reasoning_text(grok_out[1]),
            )
            return {"event_id": event_id, "prediction": pred, "reasoning": reasoning}

        # Fallback path.
        fallback = await run_desearch_fallback(client, title, description, cutoff, budget)
        if fallback is not None:
            blended = blend_with_market(domain, fallback[0], related)
            posterior = post_calibrate(blended, domain)
            evidence = await collect_reasoning_evidence(
                client, event_data, domain, title, description, budget, related
            )
            evidence_strength = evidence_strength_score(evidence)
            guarded = reliability_guard(
                posterior,
                mode="fallback",
                domain=domain,
                related=related,
                prior=supervisor_prior,
                evidence_strength=evidence_strength,
            )
            pred = translate_with_prior(guarded, supervisor_prior, "fallback", evidence_strength)
            reasoning = render_reasoning(
                mode="desearch_fallback",
                event_title=title,
                domain=domain,
                prediction=pred,
                supervisor_prior=supervisor_prior,
                match=related,
                evidence=evidence,
                llm_reasoning=fallback[1],
            )
            return {"event_id": event_id, "prediction": pred, "reasoning": reasoning}

        # Last-ditch fallback: related market if any, else safe default.
        if related is not None:
            posterior = post_calibrate(related.yes_price, domain)
            evidence = await collect_reasoning_evidence(
                client, event_data, domain, title, description, budget, related
            )
            evidence_strength = evidence_strength_score(evidence)
            guarded = reliability_guard(
                posterior,
                mode="fallback",
                domain=domain,
                related=related,
                prior=supervisor_prior,
                evidence_strength=evidence_strength,
            )
            pred = translate_with_prior(guarded, supervisor_prior, "fallback", evidence_strength)
            reasoning = render_reasoning(
                mode="market_related_fallback",
                event_title=title,
                domain=domain,
                prediction=pred,
                supervisor_prior=supervisor_prior,
                match=related,
                evidence=evidence,
                llm_reasoning="LLM unavailable; used related market anchor.",
            )
            return {"event_id": event_id, "prediction": pred, "reasoning": reasoning}

        posterior = post_calibrate(SAFE_DEFAULT, domain)
        evidence = await collect_reasoning_evidence(
            client, event_data, domain, title, description, budget, None
        )
        evidence_strength = evidence_strength_score(evidence)
        guarded = reliability_guard(
            posterior,
            mode="fallback",
            domain=domain,
            related=None,
            prior=supervisor_prior,
            evidence_strength=evidence_strength,
        )
        pred = translate_with_prior(guarded, supervisor_prior, "fallback", evidence_strength)
        reasoning = render_reasoning(
            mode="safe_default_fallback",
            event_title=title,
            domain=domain,
            prediction=pred,
            supervisor_prior=supervisor_prior,
            match=None,
            evidence=evidence,
            llm_reasoning="No reliable model output; conservative default applied.",
        )
        return {"event_id": event_id, "prediction": pred, "reasoning": reasoning}


def agent_main(event_data: dict[str, Any]) -> dict[str, Any]:
    try:
        return asyncio.run(forecast(event_data))
    except Exception:
        return {
            "event_id": str(event_data.get("event_id", "unknown")),
            "prediction": SAFE_DEFAULT,
            "reasoning": "fatal_fallback",
        }

