"""
Numinous SN6 miner agent v11.

Design goals:
- Keep runtime reliable inside the 240s sandbox window.
- Route to exact/near-exact Polymarket context when available.
- Use Grok web-research path through OpenRouter when market is not exact.
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
URL_DESEARCH_SEARCH = f"{BASE_URL}/api/gateway/desearch/search"
URL_DESEARCH_CRAWL = f"{BASE_URL}/api/gateway/desearch/web/crawl"
URL_INDICIA = f"{BASE_URL}/api/gateway/numinous-indicia"

POLYMARKET_BASE = "https://gamma-api.polymarket.com"

MODEL_GROK = "x-ai/grok-4.1-fast"
MODEL_CHUTES = "Qwen/Qwen3-235B-A22B-Instruct-2507"
MODEL_CHUTES_FALLBACK = "openai/gpt-oss-120b"

TIME_BUDGET_SECONDS = 185.0
SAFE_DEFAULT = 0.35
PRED_MIN = 0.01
PRED_MAX = 0.99

RETRIABLE_CODES = {429, 500, 502, 503}
WEATHER_COEFS = (0.15, -1.386)


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


class Budget:
    def __init__(self, seconds: float):
        self._deadline = time.time() + seconds

    def remaining(self) -> float:
        return max(0.0, self._deadline - time.time())

    def has(self, reserve: float) -> bool:
        return self.remaining() > reserve


def clamp(v: float, lo: float = PRED_MIN, hi: float = PRED_MAX) -> float:
    return max(lo, min(hi, float(v)))


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
    if domain == "weather":
        return clamp(sigmoid(WEATHER_COEFS[0] * prob + WEATHER_COEFS[1]))
    # Keep non-weather outputs market-faithful; avoid unnecessary drift.
    return clamp(prob)


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
            json={"query": query, "model": "NOVA", "run_id": RUN_ID},
            timeout=min(20.0, max(6.0, budget.remaining() - 1)),
        )
        resp.raise_for_status()
        return resp.json().get("results", []) or []
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
    for q in queries[:2]:
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


def blend_with_market(domain: str, llm_pred: float, related: MarketMatch | None) -> float:
    if related is None:
        return llm_pred
    if related.similarity >= 0.88:
        w_market = 0.80 if domain in ("sports", "crypto", "app_store") else 0.72
    elif related.similarity >= 0.72:
        w_market = 0.62
    else:
        w_market = 0.46
    blended = w_market * related.yes_price + (1.0 - w_market) * llm_pred
    # Keep high-similarity forecasts close to market unless evidence is very strong.
    if related.similarity >= 0.88 and domain != "weather":
        low = max(PRED_MIN, related.yes_price - 0.12)
        high = min(PRED_MAX, related.yes_price + 0.12)
        blended = max(low, min(high, blended))
    if domain == "geopolitics":
        low = max(PRED_MIN, related.yes_price - 0.20)
        high = min(PRED_MAX, related.yes_price + 0.20)
        blended = max(low, min(high, blended))
    return clamp(blended)


async def forecast(event_data: dict[str, Any]) -> dict[str, Any]:
    budget = Budget(TIME_BUDGET_SECONDS)
    event_id = str(event_data.get("event_id", "unknown"))
    title = str(event_data.get("title", "")).strip()
    description = str(event_data.get("description", "")).strip()
    cutoff = str(event_data.get("cutoff", ""))

    if not title:
        return {"event_id": event_id, "prediction": SAFE_DEFAULT, "reasoning": "empty_title_fallback"}

    domain = classify_domain(event_data)

    timeout_cfg = httpx.Timeout(35.0)
    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        match = await route_market_match(client, title, description, budget)

        # Exact market route.
        if match.status == "EXACT" and match.exact_match is not None:
            raw = match.exact_match.yes_price
            pred = post_calibrate(raw, domain if domain == "weather" else "exact")
            return {
                "event_id": event_id,
                "prediction": pred,
                "reasoning": f"market_exact sim={match.exact_match.similarity:.2f}",
            }

        # App-store related route with structured context.
        if domain == "app_store" and match.context:
            app_out = await run_appstore_llm(client, title, description, cutoff, match.context, budget)
            if app_out is not None:
                blended = blend_with_market(domain, app_out[0], match.related_match)
                return {
                    "event_id": event_id,
                    "prediction": post_calibrate(blended, domain),
                    "reasoning": app_out[1][:1800],
                }

        # Grok research path with web plugin.
        related = match.related_match
        market_hint = "none"
        if related is not None:
            market_hint = f"yes_price={related.yes_price:.3f}, sim={related.similarity:.2f}, question={related.question[:120]}"
        indicia = await get_indicia_summary(client, title, budget)
        grok_out = await run_grok_research(
            client, title, description, cutoff, market_hint, indicia, budget
        )
        if grok_out is not None:
            blended = blend_with_market(domain, grok_out[0], related)
            return {
                "event_id": event_id,
                "prediction": post_calibrate(blended, domain),
                "reasoning": grok_out[1][:1800],
            }

        # Fallback path.
        fallback = await run_desearch_fallback(client, title, description, cutoff, budget)
        if fallback is not None:
            blended = blend_with_market(domain, fallback[0], related)
            return {
                "event_id": event_id,
                "prediction": post_calibrate(blended, domain),
                "reasoning": fallback[1],
            }

        # Last-ditch fallback: related market if any, else safe default.
        if related is not None:
            return {
                "event_id": event_id,
                "prediction": post_calibrate(related.yes_price, domain),
                "reasoning": f"market_related_fallback sim={related.similarity:.2f}",
            }

        return {
            "event_id": event_id,
            "prediction": post_calibrate(SAFE_DEFAULT, domain),
            "reasoning": "model_fallback",
        }


def agent_main(event_data: dict[str, Any]) -> dict[str, Any]:
    try:
        return asyncio.run(forecast(event_data))
    except Exception:
        return {
            "event_id": str(event_data.get("event_id", "unknown")),
            "prediction": SAFE_DEFAULT,
            "reasoning": "fatal_fallback",
        }

