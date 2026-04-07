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

export interface ContentTopicInput {
  topic?: string;
  audience?: string;
  buyer_intent?: 'low' | 'medium' | 'high';
  region?: string;
}

export interface MonetizedResearchInput extends ContentTopicInput {
  source_notes?: string[];
  keyword_seed?: string[];
}

export interface SeoArticleInput extends ContentTopicInput {
  angle?: string;
  monetization_goal_usd_monthly?: number;
}

export interface AffiliateMapperInput extends ContentTopicInput {
  candidate_programs?: Array<{
    name?: string;
    payout_usd?: number;
    conversion_rate_pct?: number;
    approval_difficulty?: 'easy' | 'medium' | 'hard';
  }>;
}

export interface PublishingTargetsInput extends ContentTopicInput {
  existing_assets?: string[];
  publication_count?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
