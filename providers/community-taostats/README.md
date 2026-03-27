# Community Taostats Provider

DRAIN micropayment provider for the [Taostats API](https://docs.taostats.io) — Bittensor ecosystem data.

## What It Does

AI agents can purchase Bittensor data (prices, metagraph, subnets, validators, miners, staking, etc.) via DRAIN micropayments and use a built-in router model to map goals to the right subnet/provider path. Covers 60+ Taostats API endpoints via `taostats/query` plus routing via `bittensor/hub-router`.

## Pricing

| Model | Price |
|-------|-------|
| `taostats/query` | $0.005 per request |
| `bittensor/hub-router` | $0.005 per request (default) |

## Endpoints

- **GET /v1/models** — Available models
- **GET /v1/pricing** — DRAIN pricing info
- **GET /v1/docs** — Full usage instructions for agents
- **POST /v1/chat/completions** — Query Taostats or route intents (requires DRAIN voucher)
- **GET /health** — Health check

## Agent Usage

```json
// drain_chat message content
{"endpoint": "metagraph/latest", "params": {"netuid": 58, "limit": 10}}
```

```json
// hub routing message content
{"goal": "maximize SN13 mining emissions and publish discoverable SN58 providers", "constraints": {"priority": "reliability"}}
```

## Setup

```bash
cp env.example .env
# Edit .env with your keys
npm install
npm run build
npm start
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TAOSTATS_API_KEY` | Yes | — | Taostats API key |
| `PROVIDER_PRIVATE_KEY` | Yes | — | DRAIN wallet private key |
| `POLYGON_RPC_URL` | No | public | Polygon RPC for claiming |
| `PRICE_PER_REQUEST_USDC` | No | 0.005 | Price per request |
| `PRICE_PER_HUB_ROUTE_USDC` | No | 0.005 | Price for `bittensor/hub-router` (defaults to request price) |
| `CHAIN_ID` | No | 137 | 137 = Polygon, 80002 = Amoy |
| `PORT` | No | 3000 | Server port |

## Deployment

Designed for Railway deployment. Set all environment variables in the Railway dashboard — never commit secrets.
