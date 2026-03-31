# Mozart-ValidatorAlpha

DRAIN micropayment provider for validator-focused economics: commission strategy, delegation pricing, and reward-curve projections for subnet operators on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `validatoralpha/commission-strategy` | Suggested commission take, competitiveness vs peers, and stake-weight context | $0.004 |
| `validatoralpha/delegation-pricing` | Minimum delegation, fee band vs peer median, attractiveness score | $0.006 |
| `validatoralpha/reward-curve` | Deterministic cumulative TAO projection over epochs with sensitivity | $0.008 |

## What it does

This is NOT an LLM provider. Each model returns a deterministic JSON payload from structured inputs (see `GET /v1/docs`).

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

`/providers/mozart-validatoralpha`
