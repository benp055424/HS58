# Mozart-Execpath

DRAIN micropayment provider for execution-layer workflows: compile money plans into command-level tasks, generate proof bundles, and audit progress gaps.

## Models

| Model | Description | Default Price |
|---|---|---|
| `execpath/task-compiler` | Convert strategic tasks into command-level runbooks with rollback commands | $0.010 |
| `execpath/proof-builder` | Build deterministic proof bundles (logs/screenshots/tx hashes/csv/json/url) | $0.012 |
| `execpath/progress-auditor` | Audit completion %, compute delta-to-goal, and output next best actions | $0.011 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON execution artifacts for end-to-end money workflows.

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

`/providers/mozart-execpath`
