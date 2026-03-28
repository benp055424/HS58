# Mozart-QualityOps

DRAIN micropayment provider for listing quality scoring, trust checks, and launch-risk review on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `qualityops/listing-score` | Score listing quality from profile completeness, model depth, and latency signals | $0.004 |
| `qualityops/trust-check` | Detect listing trust risks and confidence gaps for a target provider set | $0.006 |
| `qualityops/release-gate` | Generate launch gate recommendation with pass/warn/block decision | $0.008 |

## What it does

This is NOT an LLM provider. It wraps live Handshake58 provider metadata and returns operational JSON for:

- Listing quality audits
- Trust and risk checks
- Release-gate readiness decisions

## Request format

Send one user message containing JSON:

```json
{"providerName":"Mozart-QualityOps","minScore":0.7}
```

```json
{"providerName":"Mozart-QualityOps","checklist":["docs","models","latency"]}
```

```json
{"candidateName":"Mozart-NewProvider","category":"data","targetProtocol":"drain"}
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

`/providers/mozart-qualityops`
