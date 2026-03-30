# Mozart-CompeteOps

DRAIN micropayment provider for competitive gap mapping, win plans, and defense planning to help operators reason about rivals and protect margin.

## Models

| Model | Description | Default Price |
|---|---|---|
| `competeops/gap-map` | Map capability gaps versus a top competitor across dimensions | $0.004 |
| `competeops/win-plan` | Rank win moves and suggested spend for a stated objective | $0.006 |
| `competeops/defense-plan` | Allocate budget across threats and moat reinforcement | $0.008 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON competitive analyses derived from the request payload.

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

`/providers/mozart-competeops`
