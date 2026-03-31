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

/** Inputs for mineralpha/task-yield-model */
export interface TaskYieldModelInput {
  subnetId?: number;
  role?: 'miner' | 'validator';
  tasksPerDay?: number;
  successRate?: number;
  rewardUsdPerKTasks?: number;
  overheadUsdDaily?: number;
}

/** Inputs for mineralpha/hardware-roi */
export interface HardwareRoiInput {
  subnetId?: number;
  hardwareCostUsd?: number;
  powerWatts?: number;
  kwhUsd?: number;
  uptime?: number;
  dailyGrossUsd?: number;
  horizonDays?: number;
}

/** Inputs for mineralpha/throughput-tuning */
export interface ThroughputTuningInput {
  subnetId?: number;
  currentRps?: number;
  targetRps?: number;
  p99LatencyMs?: number;
  workerCount?: number;
  batchSize?: number;
}

export type ToolHandler = (raw: string) => Promise<string>;
