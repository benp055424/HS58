import express from 'express';
import cors from 'cors';
import { formatUnits } from 'viem';
import { loadConfig, getModelPricing, isModelSupported, getSupportedModels } from './config.js';
import { DrainService } from './drain.js';
import { VoucherStorage } from './storage.js';
import { toolRegistry } from './tools.js';

const config = loadConfig();
const storage = new VoucherStorage(config.storagePath);
const drainService = new DrainService(config, storage);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(channelId: string): boolean {
  const now = Date.now();
  const hits = rateLimitMap.get(channelId) ?? [];
  const recent = hits.filter(t => now - t < 60_000);
  if (recent.length >= config.rateLimitPerMinute) return false;
  recent.push(now);
  rateLimitMap.set(channelId, recent);
  return true;
}

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [key, hits] of rateLimitMap) {
    const active = hits.filter(t => t > cutoff);
    if (active.length === 0) rateLimitMap.delete(key);
    else rateLimitMap.set(key, active);
  }
}, 5 * 60_000);

function requireAdmin(req: express.Request, res: express.Response): boolean {
  if (!config.adminPassword) return true;
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${config.adminPassword}`) {
    res.status(401).json({ error: 'Unauthorized. Set Authorization: Bearer <ADMIN_PASSWORD>' });
    return false;
  }
  return true;
}

app.get('/v1/pricing', (_req, res) => {
  const models: Record<string, any> = {};
  for (const id of getSupportedModels()) {
    const p = getModelPricing(id)!;
    models[id] = {
      inputPer1kTokens: formatUnits(p.inputPer1k, 6),
      outputPer1kTokens: '0',
      description: id === 'opsguard/provider-quote'
        ? 'Compare candidate providers by score, latency, and estimated spend.'
        : id === 'opsguard/budget-route'
          ? 'Build a cost-aware shortlist under a request budget.'
          : 'Generate failover chain for resilience during provider outages.',
    };
  }

  res.json({
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
    chainId: config.chainId,
    currency: 'USDC',
    decimals: 6,
    type: 'bittensor-opsguard',
    note: 'Budget and failover routing intelligence for Handshake58 providers.',
    models,
  });
});

app.get('/v1/models', (_req, res) => {
  res.json({
    object: 'list',
    data: getSupportedModels().map(id => ({
      id,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'hs58-opsguard',
    })),
  });
});

app.get('/v1/docs', (_req, res) => {
  const pQuote = formatUnits(getModelPricing('opsguard/provider-quote')!.inputPer1k, 6);
  const pBudget = formatUnits(getModelPricing('opsguard/budget-route')!.inputPer1k, 6);
  const pFailover = formatUnits(getModelPricing('opsguard/failover-plan')!.inputPer1k, 6);
  res.type('text/plain').send(`# HS58-Opsguard — Agent Instructions

This is NOT a chat/LLM provider. It returns provider-selection intelligence for cost control and resilience.

## Models
- opsguard/provider-quote ($${pQuote})
- opsguard/budget-route ($${pBudget})
- opsguard/failover-plan ($${pFailover})

## How to use via DRAIN
1. Open a payment channel to this provider (drain_open_channel)
2. Call drain_chat with:
   - model: one of the model IDs above
   - messages: ONE user message containing JSON input (required)

## Input Formats

### opsguard/provider-quote
{
  "modelHint": "gpt-4o",                  // required
  "quoteUsd": 0.10,                       // optional, default 1.0
  "category": "llm",                      // optional filter
  "protocol": "drain",                    // optional: drain | mpp | x402 | all
  "maxProviders": 5,                      // optional, default 5, max 20
  "marketplaceUrl": "https://handshake58.com" // optional override
}

### opsguard/budget-route
{
  "goal": "collect subnet stats then summarize", // required
  "maxBudgetUsd": 0.05,                    // optional, default 0.05
  "maxHops": 3,                            // optional, default 3, max 6
  "modelHint": "taostats",                 // optional filter by model id/name
  "category": "data",                      // optional filter
  "protocol": "drain",                     // optional: drain | mpp | x402 | all
  "marketplaceUrl": "https://handshake58.com" // optional override
}

### opsguard/failover-plan
{
  "modelHint": "taostats",                 // required
  "maxBackups": 2,                         // optional, default 2, max 5
  "timeoutMs": 12000,                      // optional, default 12000
  "maxRetriesPerProvider": 2,              // optional, default 2
  "circuitBreakSeconds": 120,              // optional, default 120
  "category": "data",                      // optional filter
  "protocol": "drain",                     // optional: drain | mpp | x402 | all
  "marketplaceUrl": "https://handshake58.com" // optional override
}

## Response
Assistant content is JSON string with selected providers, rationale, and next actions.

## Data Source
Live reads from:
- https://handshake58.com/api/mcp/providers

## Notes
- Rate limit: ${config.rateLimitPerMinute} req/min per channel
- Prices are heuristics from provider model metadata + defaults
- Validate downstream provider docs before production routing
`);
});

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
    chainId: config.chainId,
    models: getSupportedModels(),
  });
});

app.post('/v1/chat/completions', async (req, res) => {
  const voucherHeader = req.headers['x-drain-voucher'] as string | undefined;
  if (!voucherHeader) {
    res.status(402).set({ 'X-DRAIN-Error': 'voucher_required' }).json({
      error: { message: 'X-DRAIN-Voucher header required', type: 'payment_required', code: 'voucher_required' },
    });
    return;
  }

  const voucher = drainService.parseVoucherHeader(voucherHeader);
  if (!voucher) {
    res.status(402).set({ 'X-DRAIN-Error': 'invalid_voucher_format' }).json({
      error: { message: 'Invalid X-DRAIN-Voucher format', type: 'payment_required', code: 'invalid_voucher_format' },
    });
    return;
  }

  const model = req.body.model as string;
  if (!model || !isModelSupported(model)) {
    res.status(400).json({ error: { message: `Model not supported: ${model}. Available: ${getSupportedModels().join(', ')}` } });
    return;
  }

  if (!checkRateLimit(voucher.channelId)) {
    res.status(429).json({ error: { message: `Rate limit exceeded (${config.rateLimitPerMinute}/min)` } });
    return;
  }

  const pricing = getModelPricing(model)!;
  const cost = pricing.inputPer1k;
  const validation = await drainService.validateVoucher(voucher, cost);
  if (!validation.valid) {
    const headers: Record<string, string> = { 'X-DRAIN-Error': validation.error! };
    if (validation.error === 'insufficient_funds' && validation.channel) {
      headers['X-DRAIN-Required'] = cost.toString();
      headers['X-DRAIN-Provided'] = (BigInt(voucher.amount) - validation.channel.totalCharged).toString();
    }
    res.status(402).set(headers).json({
      error: { message: `Payment validation failed: ${validation.error}`, type: 'payment_required', code: validation.error },
    });
    return;
  }

  const channelState = validation.channel!;
  const messages = req.body.messages as Array<{ role: string; content: string }> | undefined;
  const input = messages?.filter(m => m.role === 'user').pop()?.content ?? '';
  const handler = toolRegistry.get(model);
  if (!handler) {
    res.status(500).json({ error: { message: `Handler not found for ${model}` } });
    return;
  }

  let result: string;
  try {
    result = await handler(input);
  } catch (e: any) {
    res.status(500).json({ error: { message: `Tool execution failed: ${e.message?.slice(0, 200)}` } });
    return;
  }

  drainService.storeVoucher(voucher, channelState, cost);
  const remaining = channelState.deposit - channelState.totalCharged;

  res.set({
    'X-DRAIN-Cost': cost.toString(),
    'X-DRAIN-Total': channelState.totalCharged.toString(),
    'X-DRAIN-Remaining': remaining.toString(),
    'X-DRAIN-Channel': voucher.channelId,
  }).json({
    id: `opsguard-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: 'assistant', content: result }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 0, completion_tokens: 1, total_tokens: 1 },
  });
});

app.post('/v1/close-channel', async (req, res) => {
  try {
    const { channelId } = req.body;
    if (!channelId) { res.status(400).json({ error: 'channelId required' }); return; }
    const result = await drainService.signCloseAuthorization(channelId);
    res.json({ channelId, finalAmount: result.finalAmount.toString(), signature: result.signature });
  } catch (error: any) {
    console.error('[close-channel] Error:', error?.message || error);
    res.status(500).json({ error: 'internal_error' });
  }
});

app.post('/v1/admin/claim', async (req, res) => {
  if (!requireAdmin(req, res)) return;
  try {
    const txs = await drainService.claimPayments(req.body?.forceAll === true);
    res.json({ claimed: txs.length, transactions: txs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/v1/admin/stats', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const stats = storage.getStats();
  res.json({
    ...stats,
    totalEarned: stats.totalEarned.toString(),
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
  });
});

app.get('/v1/admin/vouchers', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const unclaimed = storage.getUnclaimedVouchers();
  res.json({
    count: unclaimed.length,
    vouchers: unclaimed.map(v => ({
      channelId: v.channelId,
      amount: v.amount.toString(),
      nonce: v.nonce.toString(),
      consumer: v.consumer,
      receivedAt: new Date(v.receivedAt).toISOString(),
    })),
  });
});

async function start() {
  drainService.startAutoClaim(config.autoClaimIntervalMinutes, config.autoClaimBufferSeconds);

  app.listen(config.port, config.host, () => {
    console.log(`\n${config.providerName} running on http://${config.host}:${config.port}`);
    console.log(`Provider address: ${drainService.getProviderAddress()}`);
    console.log(`Chain: ${config.chainId === 137 ? 'Polygon' : 'Amoy Testnet'}`);
    console.log(`Models: ${getSupportedModels().length}`);
    console.log(`Rate limit: ${config.rateLimitPerMinute}/min per channel`);
    console.log(`Auto-claim: every ${config.autoClaimIntervalMinutes}min\n`);
  });
}

start().catch(error => {
  console.error('Failed to start:', error);
  process.exit(1);
});
