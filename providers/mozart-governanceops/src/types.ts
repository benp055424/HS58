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

export interface ProviderModel {
  id: string;
  name: string;
  price: number;
}

export interface MarketplaceProvider {
  id?: string;
  name?: string;
  apiUrl?: string;
  docsUrl?: string;
  category?: string;
  additionalCategories?: string[];
  tier?: string;
  protocol?: string;
  qualityScore?: number;
  score?: number;
  status?: {
    online?: boolean;
    latencyMs?: number;
    lastChecked?: string;
  };
  models?: ProviderModel[];
}

export interface PolicyCheckInput {
  providerName: string;
  marketplaceUrl?: string;
  category?: string;
  protocol?: string;
  minQualityScore?: number;
  maxProviders?: number;
}

export interface ControlMatrixInput {
  marketplaceUrl?: string;
  category?: string;
  protocol?: string;
  requiredControls?: string[];
  limit?: number;
}

export interface ReleaseApprovalInput {
  candidateName: string;
  marketplaceUrl?: string;
  category?: string;
  targetProtocol?: string;
  minimumReadinessScore?: number;
  minBenchmarkCount?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
