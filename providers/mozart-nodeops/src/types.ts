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

export interface MinerBootstrapInput {
  subnetId?: number;
  targetDailyBudgetUsd?: number;
  hardwareTier?: 'starter' | 'pro' | 'max';
  region?: string;
  hoursPerDay?: number;
}

export interface ValidatorBootstrapInput {
  subnetId?: number;
  targetStakeTao?: number;
  targetDailyBudgetUsd?: number;
  reliabilityTarget?: number;
  region?: string;
}

export interface EmissionsSimInput {
  subnetId?: number;
  role?: 'miner' | 'validator';
  stakeTao?: number;
  hardwareCostUsdMonthly?: number;
  infraCostUsdDaily?: number;
  expectedDailyRewardTao?: number;
  taoPriceUsd?: number;
  days?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
