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

export interface SubnetCoverageInput {
  marketplaceUrl?: string;
  modelHint?: string;
  category?: string;
  protocol?: string;
  maxProviders?: number;
}

export interface ValidatorMinerSignalInput {
  marketplaceUrl?: string;
  modelHint?: string;
  quoteUsd?: number;
  maxProviders?: number;
  category?: string;
  protocol?: string;
}

export interface EmissionRotationInput {
  marketplaceUrl?: string;
  modelHint?: string;
  maxBudgetUsd?: number;
  maxBackups?: number;
  category?: string;
  protocol?: string;
  failureThreshold?: number;
  timeoutMs?: number;
  rotationWindowSeconds?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
