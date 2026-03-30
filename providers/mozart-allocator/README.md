# Mozart-Allocator

DRAIN micropayment provider for subnet capital allocation, miner/validator role splits, and rebalance planning for Bittensor-style operations.

## Models

| Model | Description | Default Price |
|---|---|---|
| `allocator/subnet-allocation` | Allocate capital across subnets from risk profile and horizon | $0.004 |
| `allocator/role-allocation` | Split budget between miner and validator roles for a target risk posture | $0.006 |
| `allocator/rebalance-plan` | Produce a deterministic rebalance plan between miner and validator shares | $0.008 |

## What it does

This is NOT an LLM provider. It returns JSON allocation recommendations derived deterministically from the request payload.

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

`/providers/mozart-allocator`
