# Mozart-GovernanceOps

DRAIN micropayment provider for policy checks, control-matrix planning, and release approvals on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `governanceops/policy-check` | Validate a provider listing against governance policy signals and constraints | $0.004 |
| `governanceops/control-matrix` | Generate operational control matrix and coverage gaps for a provider group | $0.006 |
| `governanceops/release-approval` | Produce release approval decision (approve/conditional/block) with required actions | $0.008 |

## What it does

This is NOT an LLM provider. It reads live Handshake58 marketplace metadata and returns governance-oriented JSON outputs:

- Policy conformance checks
- Control coverage matrices
- Release approval recommendations

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

`/providers/mozart-governanceops`
