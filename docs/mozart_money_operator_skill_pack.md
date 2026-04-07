# Mozart Money-Operator Skill Pack (Crypto + Content + Gig Arbitrage)

Purpose: publish high-demand, non-Bittensor-specific money workflows that agents can run immediately.  
All skills below are designed to output concrete execution artifacts, not generic advice.

---

## Skill 1: Crypto Opportunity Radar to Execution Brief

**One-line pitch**  
Scan market signals, rank trade opportunities, run portfolio risk checks, and output a ready-to-execute trade brief.

**Required inputs**
- `market_regime` (`risk_on|neutral|risk_off`)
- `max_positions` (1-20)
- `timeframe_days` (1-60)
- `assets[]`:
  - `symbol`
  - `sentiment_score`
  - `momentum_24h_pct`
  - `onchain_growth_7d_pct`
  - `volume_24h_usd_m`
  - `volatility_7d_pct`
  - `catalyst`
- `open_positions[]` (for risk check)
- `portfolio_usd`
- `risk_budget_pct`

**4-step chain**
1. `cryptoscout/crypto-scanner` -> ranked long/short/watch list.
2. `cryptoscout/opportunity-ranker` -> weighted opportunity portfolio.
3. `cryptoscout/risk-sentry` -> portfolio risk score + controls.
4. `cryptoscout/trade-brief` -> final thesis, sizing, stop-loss checklist.

**Final artifact**
- `crypto_execution_brief.json`:
  - ranked opportunities
  - suggested weights
  - risk controls
  - selected-trade execution brief

---

## Skill 2: Topic to Affiliate Revenue Engine

**One-line pitch**  
Turn one niche topic into monetized research, SEO article structure, affiliate program map, and publishing targets.

**Required inputs**
- `topic`
- `audience`
- `buyer_intent` (`low|medium|high`)
- `region`
- `source_notes[]` (optional)
- `keyword_seed[]` (optional)
- `angle` (optional)
- `monetization_goal_usd_monthly`
- `candidate_programs[]` (optional)
- `publication_count`

**4-step chain**
1. `contentmint/monetized-research` -> keyword and demand/opportunity scoring.
2. `contentmint/seo-article` -> SEO outline + conversion targets.
3. `contentmint/affiliate-mapper` -> ranked affiliate options by EV.
4. `contentmint/publishing-targets` -> distribution sequence and targets.

**Final artifact**
- `content_revenue_engine.json`:
  - keyword opportunity board
  - article plan
  - affiliate shortlist
  - publishing rollout plan

---

## Skill 3: Freelance Gig Arbitrage Daily Operator

**One-line pitch**  
Find high-value gigs, draft better proposals, track conversion, and plan daily execution against capacity.

**Required inputs**
- `niche`
- `target_daily_income_usd`
- `gigs[]`:
  - `platform`
  - `title`
  - `category`
  - `budget_usd`
  - `estimated_hours`
  - `urgency`
  - `client_rating`
  - `proposal_count`
- `selected_gig_title` (optional)
- `portfolio_highlights[]` (optional)
- `proposals_sent[]` (optional)
- `available_hours_per_day`
- `team_capacity`

**4-step chain**
1. `gigarb/gig-scanner` -> ranked gigs with expected value.
2. `gigarb/proposal-drafter` -> tailored proposal + bid guidance.
3. `gigarb/conversion-tracker` -> funnel and conversion diagnostics.
4. `gigarb/arbitrage-planner` -> capacity-aligned daily plan.

**Final artifact**
- `gig_arbitrage_operator_pack.json`:
  - prioritized gigs
  - proposal draft template
  - conversion snapshot
  - today’s capacity plan

---

## Skill 4: $1k/Day Multi-Channel Money Sprint

**One-line pitch**  
Run parallel crypto scouting, affiliate content monetization, and gig arbitrage to build a blended daily-income sprint.

**Required inputs**
- Crypto signal inputs (Skill 1 set)
- Content inputs (Skill 2 set)
- Gig inputs (Skill 3 set)
- `target_daily_income_usd` (default 1000)

**6-step chain**
1. `cryptoscout/opportunity-ranker` -> top trading candidates.
2. `cryptoscout/risk-sentry` -> risk bounds and controls.
3. `contentmint/monetized-research` -> highest intent keyword angles.
4. `contentmint/affiliate-mapper` -> affiliate EV shortlist.
5. `gigarb/gig-scanner` -> top expected-value gigs.
6. `gigarb/arbitrage-planner` -> capacity and execution schedule.

**Final artifact**
- `multi_channel_money_sprint.json`:
  - channel-level expected income ranges
  - risk guardrails
  - daily action queue by hour
  - fallback plan if one channel underperforms

---

## Skill 5: Weekly Profit Flywheel Retrospective + Reallocation

**One-line pitch**  
Audit the week’s results across crypto/content/gigs and reallocate effort toward the highest expected-return channels.

**Required inputs**
- Previous week `crypto_execution_brief.json` outcomes
- Previous week `content_revenue_engine.json` outcomes
- Previous week `gig_arbitrage_operator_pack.json` outcomes
- Updated market/gig/content signals
- Next-week `available_hours_per_day`, `team_capacity`

**6-step chain**
1. `cryptoscout/risk-sentry` -> evaluate trading drawdown and risk load.
2. `cryptoscout/opportunity-ranker` -> fresh ranked opportunities.
3. `contentmint/publishing-targets` -> refresh target distribution set.
4. `contentmint/affiliate-mapper` -> refresh monetization stack.
5. `gigarb/conversion-tracker` -> proposal funnel health.
6. `gigarb/arbitrage-planner` -> next-week capacity plan.

**Final artifact**
- `weekly_profit_reallocation_plan.json`:
  - what to scale, maintain, pause
  - channel allocations for next 7 days
  - KPI targets for daily and weekly checkpoints

---

## Suggested tags

- `profit`
- `trading`
- `seo`
- `affiliate`
- `freelance`
- `automation`
- `operations`

