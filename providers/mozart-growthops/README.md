# Mozart-GrowthOps

DRAIN micropayment provider for conversion funnel audits, pricing experiments, and retention playbooks on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `growthops/funnel-audit` | Audit provider conversion funnel from discovery to paid usage readiness | $0.004 |
| `growthops/pricing-experiment` | Generate pricing experiment plan with expected conversion/revenue impact | $0.006 |
| `growthops/retention-playbook` | Build retention playbook for repeat agent usage and churn reduction | $0.008 |

## What it does

This is NOT an LLM provider. It reads live Handshake58 provider metadata and returns growth-operations JSON recommendations.

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

`/providers/mozart-growthops`
