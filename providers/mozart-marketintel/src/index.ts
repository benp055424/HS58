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
      description: id === 'marketintel/sector-pulse'
        ? 'Quantify live provider strength for a target sector with fit/quality/cost signals.'
        : id === 'marketintel/provider-gap'
          ? 'Identify sector-level provider gaps and missing reliability/cost signals.'
          : 'Recommend high-edge route opportunities for a target model/sector.',
    };
  }

  res.json({
    provider: drainService.getProviderAddress(),
    providerName: config.providerName,
    chainId: config.chainId,
    currency: 'USDC',
    decimals: 6,
    type: 'bittensor-marketintel',
    note: 'Market intelligence and category gap analysis for Handshake58 providers.',
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
      owned_by: 'mozart-marketintel',
    })),
  });
});

app.get('/v1/docs', (_req, res) => {
  const pGap = formatUnits(getModelPricing('marketintel/sector-pulse')!.inputPer1k, 6);
  const pBands = formatUnits(getModelPricing('marketintel/provider-gap')!.inputPer1k, 6);
  const pEntry = formatUnits(getModelPricing('marketintel/route-opportunity')!.inputPer1k, 6);
  res.type('text/plain').send(`# Mozart-Marketintel — Agent Instructions

This is NOT a chat/LLM provider. It returns market-intelligence output from live Handshake58 provider data.

## Models
- marketintel/sector-pulse ($${pGap})
- marketintel/provider-gap ($${pBands})
- marketintel/route-opportunity ($${pEntry})

## How to use via DRAIN
1. Open a payment channel to this provider (drain_open_channel)
2. Call drain_chat with:
   - model: one of the model IDs above
   - messages: ONE user message containing JSON input (required)

## Input Formats

### marketintel/sector-pulse
{
  "sector": "data",                        // required target sector
  "modelHint": "taostats",                 // optional model keyword
  "protocol": "drain",                    // optional: drain | mpp | x402 | all
  "maxProviders": 8,                      // optional, default 5, max 20
  "category": "data",                      // optional category filter
  "marketplaceUrl": "https://handshake58.com" // optional override
}

### marketintel/provider-gap
{
  "sector": "forecasting",                 // required target sector
  "targetCount": 8,                        // optional, default 8
  "modelHint": "taostats",                 // optional keyword
  "category": "data",                      // optional filter
  "protocol": "drain",                     // optional: drain | mpp | x402 | all
  "marketplaceUrl": "https://handshake58.com" // optional override
}

### marketintel/route-opportunity
{
  "modelHint": "gpt",                      // required keyword
  "maxAlternatives": 3,                    // optional, default 3
  "category": "llm",                       // optional filter
  "protocol": "drain",                     // optional: drain | mpp | x402 | all
  "timeoutMs": 12000,                      // optional guardrail
  "maxRetries": 2,                         // optional guardrail
  "cooldownSeconds": 120,                  // optional guardrail
  "marketplaceUrl": "https://handshake58.com" // optional override
}

## Response
Assistant content is JSON string with quantified market signals and launch recommendations.

## Data Source
Live reads from:
- https://handshake58.com/api/mcp/providers

## Notes
- Rate limit: ${config.rateLimitPerMinute} req/min per channel
- Derived metrics are catalog-driven heuristics and should be validated before deployment.
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
    id: `marketintel-${Date.now()}`,
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
