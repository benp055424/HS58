# Mozart-DeployOps

DRAIN micropayment provider for deployment readiness, release governance, and post-launch tuning to help users operate profitable subnet infrastructure on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `deployops/service-readiness` | Assess readiness to launch/scale miner or validator operations safely | $0.004 |
| `deployops/release-checklist` | Generate release controls and rollback checklist for operational changes | $0.006 |
| `deployops/post-launch-tuning` | Tune live operations for better net yield and reliability | $0.008 |

## What it does

This is NOT an LLM provider. It returns deployment-focused JSON plans and tuning guidance for users operating miners/validators for emissions.

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

`/providers/mozart-deployops`
