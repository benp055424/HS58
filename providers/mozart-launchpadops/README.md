# Mozart-LaunchpadOps

DRAIN micropayment provider for miner and validator go-live checklists and a structured first-30-days operating plan for subnet operators on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `launchpadops/miner-go-live` | Deterministic miner readiness checklist and score | $0.004 |
| `launchpadops/validator-go-live` | Deterministic validator readiness checklist and score | $0.006 |
| `launchpadops/first-30-days` | Milestone plan for the first 30 days (miner or validator) | $0.008 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON checklists and milestone plans; always validate against your subnet’s live requirements.

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

`/providers/mozart-launchpadops`
