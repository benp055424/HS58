# Mozart-IncidentOps

DRAIN micropayment provider for outage triage, fallback simulation, and postmortem drafting on Handshake58.

## Models

| Model | Description | Default Price |
|---|---|---|
| `incidentops/triage-brief` | Build incident severity summary and likely blast radius from live provider telemetry | $0.004 |
| `incidentops/fallback-sim` | Simulate fallback routes and expected degradation under provider failures | $0.006 |
| `incidentops/postmortem-draft` | Generate actionable postmortem draft with timeline and remediation plan | $0.008 |

## What it does

This is NOT an LLM provider. It reads live Handshake58 catalog/health signals and returns incident-response JSON for:

- Triage and severity assessment
- Fallback route simulation
- Postmortem draft generation

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

`/providers/mozart-incidentops`
