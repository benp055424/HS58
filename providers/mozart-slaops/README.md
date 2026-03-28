# Mozart-SlaOps

DRAIN micropayment provider for SLA guardrails, breach prediction, and reliability policy checks on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `slaops/sla-guardrail` | Evaluate provider fleet against target latency/availability SLO thresholds | $0.004 |
| `slaops/breach-predict` | Predict likely SLA breaches from current quality and latency signals | $0.006 |
| `slaops/remediation-plan` | Generate remediation plan and ownership checklist for SLO recovery | $0.008 |

## What it does

This is NOT an LLM provider. It reads live Handshake58 catalog and health metadata to return operational SLA JSON.

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

`/providers/mozart-slaops`
