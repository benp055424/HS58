# AGENTS.md

## Cursor Cloud specific instructions

### Repository overview

Handshake58 (HS58) is a decentralized AI provider marketplace. This repo contains **26 independent provider templates** under `providers/`, each a standalone Express.js + TypeScript microservice. There is no root `package.json`, no workspace manager, and no shared build system. See `README.md` for full architecture.

### Running a provider locally

Each provider follows the same pattern:

```bash
cd providers/<name>
npm install
cp env.example .env   # then edit .env
npm run dev            # starts with tsx watch on port 3000 (or PORT from .env)
```

All providers require `PROVIDER_PRIVATE_KEY` (a Polygon wallet hex key). For local dev without blockchain interaction, any valid 32-byte hex key works (e.g. generate with `node -e "console.log('0x'+require('crypto').randomBytes(32).toString('hex'))"`).

### Self-contained providers (no upstream API key needed)

These 5 providers can run locally without any external API key — only `PROVIDER_PRIVATE_KEY` is required:

| Provider | Port (dev default) | Tools |
|---|---|---|
| `hs58-webtools` | 3001 | 12 web extraction tools |
| `hs58-nettools` | 3002 | 12 network diagnostic tools |
| `hs58-cryptools` | 3003 | 12 crypto/compute tools |
| `hs58-livedata` | 3004 | 14 real-time data tools |
| `hs58-tempsh` | 3005 | file hosting |

Assign different `PORT` values in each `.env` to run multiple providers simultaneously.

### Build and lint

- **Build:** `npm run build` (uses `tsup` to compile TypeScript to ESM in `dist/`)
- **Lint:** No dedicated ESLint config exists. TypeScript strict-mode compilation (`npm run build`) is the de facto lint check.
- **No automated test suites** exist in the repository.

### Key endpoints (all providers)

| Endpoint | Method | Auth | Description |
|---|---|---|---|
| `/health` | GET | None | Health check, returns provider info |
| `/v1/models` | GET | None | Lists available models/tools |
| `/v1/pricing` | GET | None | Returns pricing per model |
| `/v1/docs` | GET | None | Agent-readable usage instructions |
| `/v1/chat/completions` | POST | DRAIN voucher | Execute a tool (requires payment) |

### Gotchas

- The `/v1/chat/completions` endpoint requires a valid `X-DRAIN-Voucher` header with a signed EIP-712 payment voucher. You cannot test it with a plain curl — use the public read-only endpoints (`/health`, `/v1/models`, `/v1/pricing`, `/v1/docs`) for verification.
- `POLYGON_RPC_URL` is optional for starting the server but required for claiming payments. Without it, a warning is logged and the public RPC is used.
- Each provider stores vouchers in `./data/vouchers.json` — this directory is created automatically on first write.
- Providers that need upstream API keys (e.g. `hs58-openai` → `OPENAI_API_KEY`) will fail at startup with `Missing env: <KEY>` if the key is not set.
