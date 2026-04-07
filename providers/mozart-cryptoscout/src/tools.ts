import type {
  AssetSignal,
  CryptoScannerInput,
  OpportunityRankerInput,
  RiskSentryInput,
  ToolHandler,
  TradeBriefInput,
} from './types.js';

type IngestionMode = 'provided' | 'live' | 'fallback';

interface IngestionInfo {
  mode: IngestionMode;
  sources: string[];
  fetched_at: string;
  asset_count: number;
  note?: string;
}

const LIVE_ASSET_FALLBACK: AssetSignal[] = [
  { symbol: 'BTC', sentiment_score: 68, momentum_24h_pct: 2.6, onchain_growth_7d_pct: 5.4, volume_24h_usd_m: 36000, volatility_7d_pct: 21, catalyst: 'fallback-large-cap-liquidity' },
  { symbol: 'ETH', sentiment_score: 64, momentum_24h_pct: 1.9, onchain_growth_7d_pct: 4.6, volume_24h_usd_m: 18000, volatility_7d_pct: 24, catalyst: 'fallback-smart-contract-demand' },
  { symbol: 'SOL', sentiment_score: 61, momentum_24h_pct: 3.4, onchain_growth_7d_pct: 8.1, volume_24h_usd_m: 5200, volatility_7d_pct: 33, catalyst: 'fallback-high-beta-momentum' },
  { symbol: 'XRP', sentiment_score: 54, momentum_24h_pct: 0.8, onchain_growth_7d_pct: 2.4, volume_24h_usd_m: 2900, volatility_7d_pct: 19, catalyst: 'fallback-range-bound-flow' },
  { symbol: 'DOGE', sentiment_score: 58, momentum_24h_pct: 2.1, onchain_growth_7d_pct: 6.2, volume_24h_usd_m: 1800, volatility_7d_pct: 38, catalyst: 'fallback-speculative-rotation' },
  { symbol: 'LINK', sentiment_score: 57, momentum_24h_pct: 1.2, onchain_growth_7d_pct: 3.8, volume_24h_usd_m: 1200, volatility_7d_pct: 27, catalyst: 'fallback-oracle-demand' },
];

function parseInput<T>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInteger(value: unknown, fallback = 0): number {
  return Math.floor(toNumber(value, fallback));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function normalizeRegime(regime: unknown): 'risk_on' | 'neutral' | 'risk_off' {
  const r = String(regime || '').toLowerCase();
  if (r === 'risk_on' || r === 'risk_off') return r;
  return 'neutral';
}

function clampPercent(value: unknown): number {
  return clamp(toNumber(value, 0), -100, 100);
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  return clamp(toNumber(process.env[name], fallback), min, max);
}

async function fetchJson(url: string, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`upstream_http_${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFearGreed(timeoutMs: number): Promise<number | null> {
  try {
    const payload = await fetchJson('https://api.alternative.me/fng/?limit=1', timeoutMs);
    const value = toNumber(payload?.data?.[0]?.value, NaN);
    return Number.isFinite(value) ? clamp(value, 0, 100) : null;
  } catch {
    return null;
  }
}

function fallbackAssets(limit: number): AssetSignal[] {
  return LIVE_ASSET_FALLBACK.slice(0, limit);
}

async function fetchLiveAssets(limit: number, timeoutMs: number): Promise<AssetSignal[]> {
  const marketUrl = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${Math.max(
    10,
    limit
  )}&page=1&sparkline=false&price_change_percentage=24h,7d`;
  const [marketData, fearGreed] = await Promise.all([
    fetchJson(marketUrl, timeoutMs),
    fetchFearGreed(timeoutMs),
  ]);
  const fg = fearGreed ?? 50;

  if (!Array.isArray(marketData)) return [];
  return marketData
    .map((row: any, idx: number) => {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (!symbol) return null;
      const momentum24 = clampPercent(row?.price_change_percentage_24h);
      const onchain7d = clampPercent(row?.price_change_percentage_7d_in_currency ?? momentum24 * 1.2);
      const volumeM = Math.max(0, toNumber(row?.total_volume, 0) / 1_000_000);
      const volatility = clamp(Math.abs(momentum24) * 2.2 + Math.abs(onchain7d) * 1.3, 6, 220);
      const sentiment = clamp(
        fg * 0.5 +
          ((momentum24 + 100) / 2) * 0.25 +
          ((onchain7d + 100) / 2) * 0.15 +
          (Math.min(volumeM, 50_000) / 50_000) * 10,
        0,
        100
      );
      return {
        symbol,
        sentiment_score: Number(sentiment.toFixed(2)),
        momentum_24h_pct: momentum24,
        onchain_growth_7d_pct: onchain7d,
        volume_24h_usd_m: Number(volumeM.toFixed(2)),
        volatility_7d_pct: Number(volatility.toFixed(2)),
        catalyst: `${String(row?.name || symbol)} market-cap rank ${idx + 1} live feed`,
      } as AssetSignal;
    })
    .filter((v): v is AssetSignal => Boolean(v))
    .slice(0, limit);
}

function cleanAssets(input: CryptoScannerInput): AssetSignal[] {
  if (!Array.isArray(input.assets)) return [];
  return input.assets
    .map((a) => ({
      symbol: String(a?.symbol || '').toUpperCase(),
      sentiment_score: clamp(toNumber(a?.sentiment_score, 50), 0, 100),
      momentum_24h_pct: clampPercent(a?.momentum_24h_pct),
      onchain_growth_7d_pct: clampPercent(a?.onchain_growth_7d_pct),
      volume_24h_usd_m: Math.max(0, toNumber(a?.volume_24h_usd_m, 0)),
      volatility_7d_pct: clamp(toNumber(a?.volatility_7d_pct, 25), 0, 250),
      catalyst: String(a?.catalyst || ''),
    }))
    .filter((a) => a.symbol.length > 0);
}

async function resolveAssets(input: CryptoScannerInput): Promise<{ assets: AssetSignal[]; ingestion: IngestionInfo }> {
  const provided = cleanAssets(input);
  if (provided.length > 0) {
    return {
      assets: provided,
      ingestion: {
        mode: 'provided',
        sources: ['caller.assets'],
        fetched_at: new Date().toISOString(),
        asset_count: provided.length,
      },
    };
  }

  const limit = envNumber('LIVE_MARKET_ASSET_LIMIT', Math.max(5, toInteger(input.max_positions, 5) * 2), 5, 30);
  const timeoutMs = envNumber('LIVE_FETCH_TIMEOUT_MS', 6000, 1500, 20000);
  try {
    const liveAssets = await fetchLiveAssets(limit, timeoutMs);
    if (liveAssets.length > 0) {
      return {
        assets: liveAssets,
        ingestion: {
          mode: 'live',
          sources: ['coingecko.markets', 'alternative.me.fng'],
          fetched_at: new Date().toISOString(),
          asset_count: liveAssets.length,
        },
      };
    }
  } catch (error: any) {
    const fallback = fallbackAssets(limit);
    return {
      assets: fallback,
      ingestion: {
        mode: 'fallback',
        sources: ['static.market.fallback'],
        fetched_at: new Date().toISOString(),
        asset_count: fallback.length,
        note: `live_fetch_failed:${String(error?.message || 'unknown').slice(0, 80)}`,
      },
    };
  }

  const fallback = fallbackAssets(limit);
  return {
    assets: fallback,
    ingestion: {
      mode: 'fallback',
      sources: ['static.market.fallback'],
      fetched_at: new Date().toISOString(),
      asset_count: fallback.length,
      note: 'live_fetch_returned_empty',
    },
  };
}

function sideFor(score: number, regime: 'risk_on' | 'neutral' | 'risk_off'): 'long' | 'short' | 'watch' {
  if (regime === 'risk_off') return score < 40 ? 'short' : score > 75 ? 'watch' : 'short';
  if (score >= 65) return 'long';
  if (score <= 35) return 'short';
  return 'watch';
}

function scoreAsset(asset: AssetSignal, regime: 'risk_on' | 'neutral' | 'risk_off'): number {
  const sentiment = clamp(toNumber(asset.sentiment_score, 50), 0, 100);
  const momentum = clamp(toNumber(asset.momentum_24h_pct, 0), -40, 40);
  const onchain = clamp(toNumber(asset.onchain_growth_7d_pct, 0), -60, 60);
  const volume = clamp(toNumber(asset.volume_24h_usd_m, 0), 0, 50000);
  const volatility = clamp(toNumber(asset.volatility_7d_pct, 25), 0, 250);

  const regimeBias = regime === 'risk_on' ? 6 : regime === 'risk_off' ? -6 : 0;
  const momentumComponent = ((momentum + 40) / 80) * 30;
  const onchainComponent = ((onchain + 60) / 120) * 25;
  const volumeComponent = (Math.log10(Math.max(1, volume)) / Math.log10(50000)) * 15;
  const volatilityPenalty = clamp(volatility / 10, 0, 25);
  const score = sentiment * 0.35 + momentumComponent + onchainComponent + volumeComponent + regimeBias - volatilityPenalty;
  return Number(clamp(score, 0, 100).toFixed(2));
}

async function rank(input: CryptoScannerInput) {
  const regime = normalizeRegime(input.market_regime);
  const maxPositions = clamp(toInteger(input.max_positions, 5), 1, 20);
  const timeframe = clamp(toInteger(input.timeframe_days, 7), 1, 60);
  const { assets, ingestion } = await resolveAssets(input);

  const ranked = assets
    .map((asset) => {
      const score = scoreAsset(asset, regime);
      const side = sideFor(score, regime);
      const confidence = Number(clamp((score / 100) * 0.9 + 0.05, 0.05, 0.95).toFixed(4));
      const catalyst = asset.catalyst || (side === 'long' ? 'sentiment+momentum alignment' : side === 'short' ? 'negative momentum' : 'mixed');
      const stopLossPct = side === 'watch' ? 0 : Number((2 + (asset.volatility_7d_pct || 20) / 12).toFixed(2));
      return {
        symbol: asset.symbol,
        side,
        score,
        confidence,
        catalyst,
        timeframe_days: timeframe,
        stop_loss_pct: stopLossPct,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPositions);

  return { regime, maxPositions, timeframe, ranked, ingestion };
}

const cryptoScanner: ToolHandler = async (raw) => {
  const input = parseInput<CryptoScannerInput>(raw);
  const { regime, ranked, timeframe, ingestion } = await rank(input);
  return JSON.stringify({
    model: 'cryptoscout/crypto-scanner',
    scan_id: `cs_${Date.now()}`,
    market_regime: regime,
    timeframe_days: timeframe,
    ingestion,
    ranked_opportunities: ranked,
    summary: {
      long_count: ranked.filter((r) => r.side === 'long').length,
      short_count: ranked.filter((r) => r.side === 'short').length,
      watch_count: ranked.filter((r) => r.side === 'watch').length,
    },
    generatedAt: new Date().toISOString(),
  });
};

const opportunityRanker: ToolHandler = async (raw) => {
  const input = parseInput<OpportunityRankerInput>(raw);
  const { regime, ranked, ingestion } = await rank(input);
  const allocations = ranked.map((r, idx) => {
    const base = 1 / Math.max(1, ranked.length);
    const scoreBoost = (r.score / 100) * 0.5;
    const weight = Number((base + scoreBoost / (ranked.length || 1)).toFixed(4));
    return {
      rank: idx + 1,
      symbol: r.symbol,
      side: r.side,
      score: r.score,
      position_weight: weight,
      expected_edge_bps: Number((r.score * 1.6).toFixed(2)),
    };
  });

  return JSON.stringify({
    model: 'cryptoscout/opportunity-ranker',
    rank_id: `or_${Date.now()}`,
    market_regime: regime,
    ingestion,
    portfolio_plan: allocations,
    execution_policy: {
      max_concurrent_positions: allocations.length,
      rebalance_frequency_hours: regime === 'risk_on' ? 8 : 4,
    },
    generatedAt: new Date().toISOString(),
  });
};

const riskSentry: ToolHandler = async (raw) => {
  const input = parseInput<RiskSentryInput>(raw);
  const { ranked, ingestion } = await rank(input);
  const positions = Array.isArray(input.open_positions) ? input.open_positions : [];
  const grossExposure = positions.reduce((sum, p) => sum + Math.max(0, toNumber(p.size_usd, 0)), 0);
  const leveraged = positions.filter((p) => toNumber(p.leverage, 1) > 1).length;
  const avgDrawdown = positions.length
    ? positions.reduce((sum, p) => {
      const entry = toNumber(p.entry_price, 0);
      const current = toNumber(p.current_price, entry);
      if (entry <= 0) return sum;
      const dd = ((entry - current) / entry) * 100;
      return sum + clamp(dd, -200, 200);
    }, 0) / positions.length
    : 0;
  const riskScore = Number(clamp(avgDrawdown * 1.8 + leveraged * 8 + (grossExposure > 50000 ? 12 : 0), 5, 95).toFixed(2));
  const riskBand = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'low';

  return JSON.stringify({
    model: 'cryptoscout/risk-sentry',
    sentry_id: `rs_${Date.now()}`,
    risk_score: riskScore,
    risk_band: riskBand,
    ingestion,
    controls: [
      'cap per-trade risk <= 1.5% equity',
      'pause new entries after 3 consecutive losses',
      'reduce leverage by 1 step if realized vol spikes > 30%',
    ],
    portfolio_snapshot: {
      open_positions: positions.length,
      leveraged_positions: leveraged,
      gross_exposure_usd: Number(grossExposure.toFixed(2)),
      avg_drawdown_pct: Number(avgDrawdown.toFixed(2)),
    },
    market_context: ranked.slice(0, 3),
    generatedAt: new Date().toISOString(),
  });
};

const tradeBrief: ToolHandler = async (raw) => {
  const input = parseInput<TradeBriefInput>(raw);
  const { ranked, ingestion } = await rank(input);
  const selected = input.selected_symbol
    ? ranked.find((r) => r.symbol === String(input.selected_symbol).toUpperCase())
    : ranked[0];
  const portfolioUsd = Math.max(0, toNumber(input.portfolio_usd, 10000));
  const riskBudgetPct = clamp(toNumber(input.risk_budget_pct, 1), 0.1, 5);
  const riskUsd = (portfolioUsd * riskBudgetPct) / 100;
  const conviction = selected ? selected.confidence : 0.35;
  const maxPositionUsd = Number((riskUsd * (2 + conviction)).toFixed(2));

  return JSON.stringify({
    model: 'cryptoscout/trade-brief',
    brief_id: `tb_${Date.now()}`,
    selected_symbol: selected?.symbol ?? null,
    side: selected?.side ?? 'watch',
    score: selected?.score ?? 0,
    ingestion,
    thesis: selected ? selected.catalyst : 'insufficient data; collect fresh asset signals',
    risk_plan: {
      portfolio_usd: Number(portfolioUsd.toFixed(2)),
      risk_budget_pct: Number(riskBudgetPct.toFixed(2)),
      risk_budget_usd: Number(riskUsd.toFixed(2)),
      max_position_usd: maxPositionUsd,
    },
    checklist: [
      'verify liquidity and spread before order',
      'set stop loss before entry execution',
      'log entry reason and invalidation rule',
    ],
    generatedAt: new Date().toISOString(),
  });
};

export const toolRegistry = new Map<string, ToolHandler>([
  ['cryptoscout/crypto-scanner', cryptoScanner],
  ['cryptoscout/opportunity-ranker', opportunityRanker],
  ['cryptoscout/risk-sentry', riskSentry],
  ['cryptoscout/trade-brief', tradeBrief],
]);
