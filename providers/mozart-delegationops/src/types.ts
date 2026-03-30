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

/** Input for delegationops/delegator-profile */
export interface DelegatorProfileInput {
  subnetId?: number;
  delegatorRole?: 'retail' | 'institutional' | 'subnet-operator';
  targetStakeTao?: number;
  diversificationTarget?: number;
  horizonWeeks?: number;
  riskTolerance?: 'low' | 'medium' | 'high';
}

/** Input for delegationops/campaign-plan */
export interface CampaignPlanInput {
  campaignGoal?: string;
  audience?: 'miners' | 'validators' | 'mixed';
  durationDays?: number;
  channels?: string[];
  budgetTao?: number;
}

/** Input for delegationops/retention-playbook */
export interface RetentionPlaybookInput {
  segment?: 'new' | 'active' | 'at-risk';
  churnSignals?: string[];
  incentiveBudgetTao?: number;
  communicationCadenceDays?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
