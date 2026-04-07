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

export type ExecEnvironment = 'local' | 'cloud' | 'hybrid';

export interface ExecTask {
  task_id?: string;
  description?: string;
  expected_output_artifact?: string;
}

export interface ExecContext {
  environment?: ExecEnvironment;
  wallet_state?: Record<string, unknown>;
  provider_urls?: string[];
}

export interface ExecPathBaseInput {
  strategy_id?: string;
  execution_context?: ExecContext;
  tasks?: ExecTask[];
}

export interface TaskCompilerInput extends ExecPathBaseInput {
  target_week?: number;
}

export interface CompletedTaskOutput {
  task_id?: string;
  output_type?: string;
  output_value?: string;
}

export interface ProofBuilderInput extends ExecPathBaseInput {
  completed_task_outputs?: CompletedTaskOutput[];
}

export interface ExecutionLogEntry {
  task_id?: string;
  status?: string;
  note?: string;
  timestamp?: string;
}

export interface ProgressAuditorInput extends ExecPathBaseInput {
  execution_log?: ExecutionLogEntry[];
  kpi_snapshot?: {
    monthly_income_goal_usd?: number;
    current_income_usd?: number;
    tao_goal?: number;
    current_tao?: number;
  };
}

export type ToolHandler = (raw: string) => Promise<string>;
