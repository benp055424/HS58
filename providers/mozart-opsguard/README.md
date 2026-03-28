# Mozart-Opsguard

DRAIN micropayment provider for budget-aware provider selection and failover planning on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `opsguard/provider-quote` | Compare providers for a requested capability with estimated per-call cost and quality signals | $0.004 |
| `opsguard/budget-route` | Build an execution route under a total USDC budget cap | $0.006 |
| `opsguard/failover-plan` | Generate primary + fallback provider sequence with failover rules | $0.008 |

## What it does

This is NOT an LLM provider. It wraps live Handshake58 provider metadata to return operational JSON for:

- Cost-aware provider shortlisting
- Budget-constrained routing
- Reliability/failover planning

## Request format

Send one user message containing JSON:

```json
{"modelHint":"gpt","quoteUsd":1.0,"category":"llm","maxProviders":5}
```

```json
{"goal":"collect subnet stats then summarize","maxBudgetUsd":0.03,"maxHops":3,"category":"data"}
```

```json
{"modelHint":"taostats","maxBackups":3,"timeoutMs":12000}
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

`/providers/mozart-opsguard`
