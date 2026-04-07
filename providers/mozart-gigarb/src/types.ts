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

export type GigPlatform = 'upwork' | 'fiverr' | 'contra' | 'other';
export type UrgencyLevel = 'low' | 'medium' | 'high';

export interface GigPosting {
  platform?: GigPlatform;
  title?: string;
  category?: string;
  budget_usd?: number;
  estimated_hours?: number;
  urgency?: UrgencyLevel;
  client_rating?: number;
  proposal_count?: number;
}

export interface GigScannerInput {
  niche?: string;
  platforms?: GigPlatform[];
  target_daily_income_usd?: number;
  gigs?: GigPosting[];
}

export interface ProposalDrafterInput extends GigScannerInput {
  selected_gig_title?: string;
  portfolio_highlights?: string[];
}

export interface ConversionTrackerInput extends GigScannerInput {
  proposals_sent?: Array<{
    gig_title?: string;
    proposal_score?: number;
    status?: 'sent' | 'shortlisted' | 'won' | 'lost';
    value_usd?: number;
  }>;
}

export interface ArbitragePlannerInput extends GigScannerInput {
  available_hours_per_day?: number;
  team_capacity?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
