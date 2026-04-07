# Mozart-GigArb

DRAIN micropayment provider for freelance gig arbitrage: gig scoring, proposal drafting, conversion tracking, and capacity planning.

## Models

| Model | Description | Default Price |
|---|---|---|
| `gigarb/gig-scanner` | Rank freelance gigs by expected value and win probability | $0.009 |
| `gigarb/proposal-drafter` | Draft deterministic winning proposal structure and bid guidance | $0.011 |
| `gigarb/conversion-tracker` | Track proposal funnel performance and conversion signals | $0.010 |
| `gigarb/arbitrage-planner` | Build daily execution plan aligned to available team capacity | $0.012 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON freelancing monetization artifacts.

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

`/providers/mozart-gigarb`
