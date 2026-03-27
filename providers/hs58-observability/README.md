# HS58-Observability

DRAIN micropayment provider for monitoring the Handshake58 marketplace and planning provider routing decisions.

## Models

| Model | Description | Default Price |
|---|---|---|
| `observability/provider-status` | Check provider online status, metadata, and model inventory | $0.004 |
| `observability/provider-ranking` | Rank providers by score/quality/category/model filters | $0.006 |
| `observability/route-plan` | Generate a practical multi-step route plan for an agent goal | $0.008 |

## What it does

This is NOT an LLM provider. It wraps live Handshake58 directory endpoints and returns operational JSON for:

- Provider availability checks
- Rank and selection workflows
- Goal-to-provider route planning

## Request format

Send one user message containing JSON:

```json
{"category":"data","tier":"community","minScore":0.5,"limit":50}
```

```json
{"category":"llm","limit":10,"sortBy":"quality"}
```

```json
{"goal":"collect social data, run analytics, summarize findings"}
```

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

`/providers/hs58-observability`
