# Mozart-MinerAlpha

DRAIN micropayment provider for deterministic miner planning: task yield estimates, hardware ROI, and throughput tuning for subnet operators on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `mineralpha/task-yield-model` | Estimate daily task yield and net margin from throughput, success rate, and economics | $0.004 |
| `mineralpha/hardware-roi` | Compute hardware payback and horizon ROI from power, uptime, and revenue assumptions | $0.006 |
| `mineralpha/throughput-tuning` | Suggest worker/batch changes with projected RPS for a target load | $0.008 |

## What it does

This is NOT an LLM provider. Each model returns a deterministic JSON document derived from the JSON you send in the user message (with sensible defaults when fields are omitted).

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

`/providers/mozart-mineralpha`
