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

/** treasuryops/runway-forecast */
export interface RunwayForecastInput {
  liquidUsd?: number;
  monthlyBurnUsd?: number;
  monthlyInflowUsd?: number;
  targetRunwayMonths?: number;
  subnetId?: number;
}

/** treasuryops/cost-envelope */
export interface CostEnvelopeInput {
  budgetUsd?: number;
  horizonMonths?: number;
  riskTolerance?: 'low' | 'medium' | 'high';
  fixedCostShare?: number;
  subnetId?: number;
}

/** treasuryops/reinvestment-plan */
export interface ReinvestmentPlanInput {
  availableUsd?: number;
  reinvestRate?: number;
  goalUsd?: number;
  horizonMonths?: number;
  subnetId?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
