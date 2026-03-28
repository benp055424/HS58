# Mozart-SubnetPulse

DRAIN micropayment provider for subnet, validator, and miner signal routing on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `subnetpulse/subnet-brief` | Build a subnet-focused provider brief for a target netuid/theme | $0.004 |
| `subnetpulse/validator-route` | Build validator-oriented execution routes with score/latency balance | $0.006 |
| `subnetpulse/miner-route` | Build miner-oriented data/ops routes with failover options | $0.008 |

## What it does

This is NOT an LLM provider. It wraps live Handshake58 provider metadata to return operational JSON for:

- Subnet-specific provider briefs
- Validator-oriented routing plans
- Miner-oriented routing plans

## Request format

Send one user message containing JSON:

```json
{"theme":"subnet 13 social data","netuid":13,"category":"data","maxProviders":5}
```

```json
{"goal":"route validator analytics tasks","modelHint":"taostats","maxHops":3,"category":"data"}
```

```json
{"goal":"route miner data collection tasks","modelHint":"scrape","maxBackups":3,"category":"scraping"}
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

`/providers/mozart-subnetpulse`
