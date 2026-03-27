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

export interface ObservabilityProvider {
  id?: string;
  name: string;
  tier?: string;
  category?: string;
  protocol?: string;
  score?: number;
  qualityScore?: number;
  isOnline?: boolean;
  inferenceOnline?: boolean;
  avgResponseTime?: number;
  models?: Array<{ id?: string; name?: string }>;
  providerAddress?: string;
  apiUrl?: string;
}

export interface RoutePlanRequest {
  goal: string;
  category?: string;
  preferredTier?: 'bittensor' | 'community';
  preferredProtocol?: 'drain' | 'mpp' | 'x402' | 'all';
  maxProviders?: number;
  requireStreaming?: boolean;
  modelHint?: string;
}

export interface RankingRequest {
  category?: string;
  modelHint?: string;
  tier?: 'bittensor' | 'community';
  protocol?: 'drain' | 'mpp' | 'x402' | 'all';
  sortBy?: 'score' | 'quality' | 'latency';
  limit?: number;
  minScore?: number;
  requireOnline?: boolean;
}

