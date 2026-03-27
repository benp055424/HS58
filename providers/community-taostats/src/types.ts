/**
 * Community Taostats Provider Types
 */

import type { Hash, Hex } from 'viem';

// --- DRAIN standard types ---

export interface ProviderConfig {
  taostatsApiUrl: string;
  taostatsApiKey: string;
  pricePerRequestUsdc: number;
  pricePerHubRouteUsdc?: number;
  port: number;
  host: string;
  chainId: 137 | 80002;
  providerPrivateKey: Hex;
  polygonRpcUrl?: string;
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

// --- Taostats API types ---

export interface QueryRequest {
  endpoint: string;
  params?: Record<string, string | number | boolean>;
}

export interface HubRouteRequest {
  goal: string;
  constraints?: Record<string, string | number | boolean>;
  preferredSubnets?: number[];
}

export interface HubRecommendation {
  provider: string;
  model: string;
  purpose: string;
  subnet?: number;
  exampleInput?: Record<string, unknown>;
}

export interface HubRouteResponse {
  goal: string;
  matchedIntent: string;
  strategy: string;
  recommendations: HubRecommendation[];
  taostatsFollowups: QueryRequest[];
  notes: string[];
}

export interface TaostatsPagination {
  current_page: number;
  per_page: number;
  total_items: number;
  total_pages: number;
  next_page: number | null;
  prev_page: number | null;
}

export interface TaostatsResponse {
  pagination?: TaostatsPagination;
  data?: unknown[];
  [key: string]: unknown;
}
