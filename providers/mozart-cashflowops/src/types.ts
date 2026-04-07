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

export type RiskBudget = 'low' | 'medium' | 'high';
export type Priority = 'scale' | 'maintain' | 'fix' | 'prune';

export interface CashflowProviderRow {
  provider?: string;
  vouchers?: number;
  active_channels?: number;
  est_earned_min_usd?: number;
  est_earned_max_usd?: number;
}

export interface CashflowTrafficData {
  providers?: CashflowProviderRow[];
}

export interface CashflowCapitalPolicy {
  reserve_ratio?: number;
  reinvest_ratio?: number;
  tao_accumulation_ratio?: number;
}

export interface RevenueScoreboardInput {
  window_days?: number;
  traffic_data?: CashflowTrafficData;
  capital_policy?: CashflowCapitalPolicy;
  segment_labels?: string[];
}

export interface ReinvestPolicyInput {
  window_days?: number;
  traffic_data?: CashflowTrafficData;
  available_capital_usd?: number;
  risk_budget?: RiskBudget;
  capital_policy?: CashflowCapitalPolicy;
}

export interface FlywheelTunerInput {
  window_days?: number;
  traffic_data?: CashflowTrafficData;
  capital_policy?: CashflowCapitalPolicy;
  current_playbook?: {
    cadence?: string;
    focus?: string[];
    kpis?: string[];
  };
  experiment_budget_usd?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
