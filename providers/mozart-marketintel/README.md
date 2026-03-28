# Mozart-MarketIntel

DRAIN micropayment provider for sector-level market pulse, provider-gap analysis, and route opportunity discovery on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `marketintel/sector-pulse` | Rank providers in a target sector using fit, cost, quality, and latency signals | $0.004 |
| `marketintel/provider-gap` | Measure current sector depth vs target capacity and highlight missing signals | $0.006 |
| `marketintel/route-opportunity` | Identify strongest provider + alternatives for a model hint and execution constraints | $0.008 |

## What it does

This is NOT an LLM provider. It wraps live Handshake58 provider metadata and returns operational JSON for:

- Sector-level provider intelligence
- Supply and coverage gap detection
- Execution route opportunity analysis

## Request format

Send one user message containing JSON:

```json
{"sector":"data","modelHint":"taostats","maxProviders":5}
```

```json
{"sector":"data","targetCount":8,"category":"data","protocol":"drain"}
```

```json
{"modelHint":"taostats","category":"data","maxAlternatives":3}
```

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

`/providers/mozart-marketintel`
