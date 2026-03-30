# Mozart-ProfitOps

DRAIN micropayment provider for opportunity scanning, ROI forecasting, and execution playbooks to help users make money on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `profitops/opportunity-scan` | Rank top monetization opportunities by expected ROI and execution complexity | $0.004 |
| `profitops/roi-forecast` | Forecast ROI for budget scenarios and estimate request/revenue break-even points | $0.006 |
| `profitops/execution-playbook` | Generate 30-day execution plan with milestones, risks, and channel metrics | $0.008 |

## What it does

This is NOT an LLM provider. It reads live Handshake58 provider metadata and returns monetization-focused JSON strategies.

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

`/providers/mozart-profitops`
