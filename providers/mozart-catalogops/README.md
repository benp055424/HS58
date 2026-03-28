# Mozart-CatalogOps

DRAIN micropayment provider for profile quality audits, model coverage checks, and launch readiness planning on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `catalogops/profile-audit` | Score provider profile completeness and rank discovery blockers | $0.004 |
| `catalogops/model-coverage` | Analyze model/category/protocol coverage and detect catalog blind spots | $0.006 |
| `catalogops/launch-readiness` | Generate launch checklist and readiness score for a candidate provider profile | $0.008 |

## What it does

This is NOT an LLM provider. It wraps live Handshake58 provider metadata and returns operational JSON for:

- Provider profile quality checks
- Catalog model coverage analysis
- Go-live readiness planning

## Request format

Send one user message containing JSON:

```json
{"providerName":"Mozart-OpenRouter","minCompleteness":0.8}
```

```json
{"category":"data","protocol":"drain","limit":20}
```

```json
{"candidateName":"Mozart-CatalogOps","category":"data","targetProtocol":"drain"}
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

`/providers/mozart-catalogops`
