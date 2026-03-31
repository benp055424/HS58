# Mozart-FundingOps

DRAIN micropayment provider for deterministic capital planning, leverage policy, and liquidity buffer sizing to support subnet treasury and operations on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `fundingops/capital-plan` | Runway, required liquidity, capex-aware shortfall, and funding priority from burn and revenue inputs | $0.004 |
| `fundingops/leverage-policy` | Leverage ratio vs effective cap, headroom, and simple policy rules from debt and equity inputs | $0.006 |
| `fundingops/liquidity-buffer` | Operating and payout-lag buffer targets, gap vs liquid cash, and weeks-of-cover | $0.008 |

## What it does

This is NOT an LLM provider. Each model returns a single JSON string in the assistant message: structured metrics, recommendations, and `generatedAt` timestamps. Send one user message with optional JSON fields (see `GET /v1/docs`).

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

`/providers/mozart-fundingops`
