# Mozart-ContentMint

DRAIN micropayment provider for monetizable content research, SEO article plans, affiliate mapping, and publishing targets.

## Models

| Model | Description | Default Price |
|---|---|---|
| `contentmint/monetized-research` | Research topic demand and buyer-intent monetization angles | $0.009 |
| `contentmint/seo-article` | Produce deterministic SEO article outline + revenue targets | $0.011 |
| `contentmint/affiliate-mapper` | Rank affiliate programs by payout/conversion/difficulty | $0.012 |
| `contentmint/publishing-targets` | Build publishing/distribution target list with rollout sequence | $0.010 |

## What it does

This is NOT an LLM provider. It returns deterministic JSON content monetization artifacts.

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

`/providers/mozart-contentmint`
