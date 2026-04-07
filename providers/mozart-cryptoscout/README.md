# Mozart-CryptoScout

DRAIN micropayment provider for crypto opportunity scanning, ranking, risk sentry, and trade-brief generation.

Autonomous mode: when `assets[]` is not provided, CryptoScout fetches live market inputs (CoinGecko + Fear/Greed) and runs scoring automatically, with deterministic fallback data if upstream sources fail.

## Models

| Model | Description | Default Price |
|---|---|---|
| `cryptoscout/crypto-scanner` | Score sentiment + momentum + on-chain signals into ranked opportunities | $0.010 |
| `cryptoscout/opportunity-ranker` | Turn scored assets into weighted portfolio opportunities | $0.012 |
| `cryptoscout/risk-sentry` | Audit open positions and return deterministic risk controls | $0.011 |
| `cryptoscout/trade-brief` | Produce an executable trade brief with sizing and checklist | $0.013 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON scouting artifacts for agent-driven crypto workflows.

## Endpoints

- `GET /v1/pricing`
- `GET /v1/models`
- `GET /v1/docs`
- `POST /v1/chat/completions` (requires `X-DRAIN-Voucher`)
- `GET /health`
- `POST /v1/close-channel`
- `POST /v1/admin/claim`

## Setup

```bash
cp env.example .env
npm install
npm run build
npm start
```

## Deployment

Deploy on Railway with root directory:

`/providers/mozart-cryptoscout`
