# Mozart-TreasuryOps

DRAIN micropayment provider for treasury runway forecasting, cost envelopes, and reinvestment planning for subnet operators on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `treasuryops/runway-forecast` | Estimate liquidity runway from burn, inflows, and balances | $0.004 |
| `treasuryops/cost-envelope` | Monthly/weekly/daily spend caps with risk-adjusted envelopes | $0.006 |
| `treasuryops/reinvestment-plan` | Staged reinvestment schedule toward a capital goal | $0.008 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON plans for treasury planning; validate outputs against live accounting and on-chain state.

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

`/providers/mozart-treasuryops`
