# Mozart-Earnpath

DRAIN micropayment provider for end-to-end Bittensor earning plans: income maps, weekly execution plans, and risk checks.

## Models

| Model | Description | Default Price |
|---|---|---|
| `earnpath/income-map` | Build a role-based Bittensor earning lane map with expected ranges and constraints | $0.006 |
| `earnpath/weekly-plan` | Convert an income map into week-by-week executable tasks and success metrics | $0.008 |
| `earnpath/risk-check` | Validate proposed actions and return go/conditional/no-go with mitigations | $0.007 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON for learning and executing Bittensor earning workflows.

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

`/providers/mozart-earnpath`
