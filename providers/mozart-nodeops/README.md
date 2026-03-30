# Mozart-NodeOps

DRAIN micropayment provider for miner/validator bootstrap planning and emissions simulation to help users make money on Bittensor subnets via Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `nodeops/miner-bootstrap` | Generate end-to-end miner bootstrap plan for a target subnet and budget | $0.004 |
| `nodeops/validator-bootstrap` | Generate validator bootstrap plan with infra, stake, and risk checks | $0.006 |
| `nodeops/emissions-sim` | Simulate emissions/revenue outcomes under uptime and performance assumptions | $0.008 |

## What it does

This is NOT an LLM provider. It returns operations-focused JSON plans and simulations for users launching miners/validators to earn emissions.

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

`/providers/mozart-nodeops`
