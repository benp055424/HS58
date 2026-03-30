# Mozart-DelegationOps

DRAIN micropayment provider for delegator profiles, delegation education campaigns, and retention playbooks on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `delegationops/delegator-profile` | Structured delegator profile with allocation hints and risk-aware scoring | $0.004 |
| `delegationops/campaign-plan` | Phased outreach campaign with channels and KPIs | $0.006 |
| `delegationops/retention-playbook` | Retention plays, cadence, and incentive bounds by segment | $0.008 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON plans for delegation operations.

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

`/providers/mozart-delegationops`
