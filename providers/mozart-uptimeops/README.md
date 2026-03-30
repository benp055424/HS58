# Mozart-UptimeOps

DRAIN micropayment provider for failure risk scoring, incident prevention guardrails, and recovery runbooks for operators on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `uptimeops/failure-risk` | Composite risk index from downtime, errors, and dependency shape | $0.004 |
| `uptimeops/incident-prevention` | Prevention score and guardrails from change and monitoring inputs | $0.006 |
| `uptimeops/recovery-runbook` | Ordered recovery steps and comms templates for RTO/RPO | $0.008 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON for reliability planning.

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

`/providers/mozart-uptimeops`
