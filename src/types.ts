export const VULN_CLASSES = {
  1: "missing_signer_check",
  2: "missing_owner_check",
  3: "account_type_confusion",
  4: "missing_relationship_constraint",
  5: "insecure_pda_seeds",
} as const;

export type VulnClass = 1 | 2 | 3 | 4 | 5;
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type Verdict = "PROVEN" | "UNCONFIRMED";
export type CaseLabel = "vulnerable" | "fixed";

export interface AccountSummary {
  name: string;
  rust_type: string;
  is_signer: boolean;
  is_mut: boolean;
  owner_constraint: string | null;
  has_one: string[];
  seeds: string | null;
  has_discriminator: boolean;
  other_constraints: string[];
}

export interface InstructionSummary {
  name: string;
  accounts_struct: string;
  extra_args: string[];
  accounts: AccountSummary[];
  handler_checks: string[];
  constraint_summary: string;
  handler_source: string;
}

export interface AccountTypeSummary {
  name: string;
  has_anchor_discriminator: boolean;
  fields: string[];
}

export interface ProgramSummary {
  program_id: string;
  program_name: string;
  source_files: string[];
  source_hash: string;
  instructions: InstructionSummary[];
  account_types: AccountTypeSummary[];
}

export interface Finding {
  vulnerability_class: VulnClass;
  instruction_name: string;
  account_name: string;
  reasoning: string;
  confidence: Confidence;
}

export interface VerifiedFinding extends Finding {
  verdict: Verdict;
  exploit_transaction: string | null;
  pre_state: Record<string, unknown> | null;
  post_state: Record<string, unknown> | null;
  notes: string;
}

export interface DatasetCase {
  id: string;
  family: string;
  variant: string;
  label: CaseLabel;
  expected_class: VulnClass | null;
  in_scope: boolean;
  program_dir: string;
}

export interface CaseResult {
  id: string;
  family: string;
  variant: string;
  label: CaseLabel;
  expected_class: VulnClass | null;
  in_scope: boolean;
  extractor: ProgramSummary | null;
  extractor_error: string | null;
  api_error: string | null;
  findings: VerifiedFinding[];
  dropped_findings: Finding[];
  runtime_ms: number;
}

export interface FalsePositiveRecord {
  instruction_name: string;
  account_name: string;
  vulnerability_class: VulnClass;
  reason: string;
}

export interface CliArgs {
  command: string;
  dataset?: string;
  program?: string;
  output?: string;
  baseline?: string;
  otter?: string;
  skipVerify?: boolean;
  inScope?: boolean;
  families?: string[];
  limit?: number;
}
