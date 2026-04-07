import type { Hash, Hex } from 'viem';

export interface ModelPricing {
  inputPer1k: bigint;
  outputPer1k: bigint;
}

export interface ProviderConfig {
  marketplaceUrl: string;
  requestTimeoutMs: number;
  maxResults: number;
  rateLimitPerMinute: number;
  adminPassword?: string;
  port: number;
  host: string;
  chainId: 137 | 80002;
  providerPrivateKey: Hex;
  polygonRpcUrl?: string;
  pricing: Map<string, ModelPricing>;
  claimThreshold: bigint;
  storagePath: string;
  providerName: string;
  autoClaimIntervalMinutes: number;
  autoClaimBufferSeconds: number;
}

export interface VoucherHeader {
  channelId: Hash;
  amount: string;
  nonce: string;
  signature: Hex;
}

export interface StoredVoucher {
  channelId: Hash;
  amount: bigint;
  nonce: bigint;
  signature: Hex;
  consumer: string;
  receivedAt: number;
  claimed: boolean;
  claimedAt?: number;
  claimTxHash?: Hash;
}

export interface ChannelState {
  channelId: Hash;
  consumer: string;
  deposit: bigint;
  totalCharged: bigint;
  expiry: number;
  lastVoucher?: StoredVoucher;
  createdAt: number;
  lastActivityAt: number;
}

export type TradeSide = 'long' | 'short' | 'watch';
export type RiskBand = 'low' | 'medium' | 'high';

export interface AssetSignal {
  symbol?: string;
  sentiment_score?: number;
  momentum_24h_pct?: number;
  onchain_growth_7d_pct?: number;
  volume_24h_usd_m?: number;
  volatility_7d_pct?: number;
  catalyst?: string;
}

export interface CryptoScannerInput {
  market_regime?: 'risk_on' | 'neutral' | 'risk_off';
  max_positions?: number;
  timeframe_days?: number;
  assets?: AssetSignal[];
}

export interface OpportunityRankerInput extends CryptoScannerInput {}

export interface RiskSentryInput extends CryptoScannerInput {
  open_positions?: Array<{
    symbol?: string;
    side?: TradeSide;
    entry_price?: number;
    current_price?: number;
    size_usd?: number;
    leverage?: number;
  }>;
}

export interface TradeBriefInput extends CryptoScannerInput {
  selected_symbol?: string;
  portfolio_usd?: number;
  risk_budget_pct?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
