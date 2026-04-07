# Mozart-CashflowOps

DRAIN micropayment provider for Bittensor revenue scoreboards, reinvestment policies, and flywheel tuning experiments.

## Models

| Model | Description | Default Price |
|---|---|---|
| `cashflowops/revenue-scoreboard` | Score provider portfolio momentum and efficiency with scale/maintain/fix/prune priorities | $0.009 |
| `cashflowops/reinvest-policy` | Allocate available capital across build/marketing/ops/tao_buy/reserve | $0.012 |
| `cashflowops/flywheel-tuner` | Propose constrained experiments to improve repeat traffic and paid conversion | $0.014 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON cashflow operations artifacts for Bittensor income systems.

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

`/providers/mozart-cashflowops`
