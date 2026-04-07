import type {
  AssetSignal,
  CryptoScannerInput,
  OpportunityRankerInput,
  RiskSentryInput,
  ToolHandler,
  TradeBriefInput,
} from './types.js';

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

function rank(input: CryptoScannerInput) {
  const regime = normalizeRegime(input.market_regime);
  const maxPositions = clamp(toInteger(input.max_positions, 5), 1, 20);
  const timeframe = clamp(toInteger(input.timeframe_days, 7), 1, 60);
  const assets = cleanAssets(input);

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

  return { regime, maxPositions, timeframe, ranked };
}

const cryptoScanner: ToolHandler = async (raw) => {
  const input = parseInput<CryptoScannerInput>(raw);
  const { regime, ranked, timeframe } = rank(input);
  return JSON.stringify({
    model: 'cryptoscout/crypto-scanner',
    scan_id: `cs_${Date.now()}`,
    market_regime: regime,
    timeframe_days: timeframe,
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
  const { regime, ranked } = rank(input);
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
    generatedAt: new Date().toISOString(),
  });
};

const tradeBrief: ToolHandler = async (raw) => {
  const input = parseInput<TradeBriefInput>(raw);
  const { ranked } = rank(input);
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
