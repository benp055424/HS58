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

export type Role = 'miner' | 'validator' | 'provider' | 'allocator' | 'operator';
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';
export type RiskTolerance = 'low' | 'medium' | 'high';

export interface EarnpathProfile {
  role?: Role;
  experience_level?: ExperienceLevel;
  hours_per_week?: number;
  capital_usd?: number;
  risk_tolerance?: RiskTolerance;
}

export interface EarnpathTargets {
  monthly_income_goal_usd?: number;
  tao_accumulation_goal?: number;
  time_horizon_days?: number;
}

export interface EarnpathConstraints {
  region?: string;
  compliance_limits?: string[];
  tooling_available?: string[];
}

export interface EarnpathBaseline {
  current_monthly_income_usd?: number;
  current_tao_holdings?: number;
}

export interface EarningLane {
  lane: string;
  expected_monthly_range_usd?: { min: number; max: number };
  time_to_first_revenue_days?: number;
  dependencies?: string[];
  key_risks?: string[];
}

export interface IncomeMapInput {
  profile?: EarnpathProfile;
  targets?: EarnpathTargets;
  constraints?: EarnpathConstraints;
  baseline?: EarnpathBaseline;
}

export interface WeeklyPlanInput extends IncomeMapInput {
  income_map?: {
    strategy_id?: string;
    earning_lanes?: EarningLane[];
    recommended_primary_lane?: string;
  };
}

export interface ProposedAction {
  action_id?: string;
  lane?: string;
  description?: string;
  estimated_hours?: number;
  requires_capital_usd?: number;
  requires_operational_readiness?: boolean;
}

export interface RiskCheckInput extends IncomeMapInput {
  proposed_actions?: ProposedAction[];
}

export type ToolHandler = (raw: string) => Promise<string>;
