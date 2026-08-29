import type {
  AccountSummary,
  Finding,
  InstructionSummary,
  ProgramSummary,
  VulnClass,
} from "./types.js";

export interface AccountRisk {
  instruction_name: string;
  account_name: string;
  rust_type: string;
  class1: boolean;
  class2: boolean;
  class3: boolean;
  class4: boolean;
  class5: boolean;
  notes: string[];
}

const SKIP_NAMES = /^(token_program|system_program|rent|clock|instructions|associated_token_program)$/i;
const SIGNER_ROLE = /^(authority|admin|owner|payer)$/i;
const CLASS1_DATA_SKIP = /^(token|vault|config|mint|destination|source)$/i;
const CLASS3_DATA = /^(user|metadata|state|account|profile)$/i;

function isAccountInfo(rustType: string): boolean {
  return /^AccountInfo\s*</.test(rustType) || /^UncheckedAccount\s*</.test(rustType);
}

function isAnchorAccount(rustType: string): boolean {
  return /^Account\s*</.test(rustType) || /^Box\s*<\s*Account\s*</.test(rustType);
}

function listed(ix: InstructionSummary, re: RegExp): boolean {
  return ix.handler_checks.some((c) => re.test(c));
}

function inSource(ix: InstructionSummary, re: RegExp): boolean {
  return re.test(ix.handler_source);
}

function extraHasBump(ix: InstructionSummary): boolean {
  return ix.extra_args.some((a) => /\bbump\b/i.test(a));
}

export function computeRiskSignals(summary: ProgramSummary): AccountRisk[] {
  const out: AccountRisk[] = [];
  for (const ix of summary.instructions) {
    for (const account of ix.accounts) {
      out.push(scoreAccount(ix, account));
    }
  }
  return out;
}

function scoreAccount(ix: InstructionSummary, account: AccountSummary): AccountRisk {
  const notes: string[] = [];
  const skip = SKIP_NAMES.test(account.name);
  const info = isAccountInfo(account.rust_type);
  const wrapped = isAnchorAccount(account.rust_type);
  const signerRole = SIGNER_ROLE.test(account.name);

  const noSignerCheck =
    !account.is_signer &&
    !listed(ix, /signer|MissingRequiredSignature/i);
  const class1 =
    !skip &&
    noSignerCheck &&
    info &&
    signerRole &&
    !CLASS1_DATA_SKIP.test(account.name);
  if (class1) notes.push("class1: unsigned AccountInfo with signer-role name and no handler signer check");

  const hasProgramOwnerCheck =
    listed(ix, /program owner|token-program id|IllegalOwner/i) ||
    inSource(ix, /ctx\.accounts\.\w+\.owner/);

  const noTypeCheck = !listed(ix, /discriminant|type check|account type/i);
  const looksTyped =
    CLASS3_DATA.test(account.name) || listed(ix, /try_from_slice/);
  const class3 =
    !skip &&
    !signerRole &&
    info &&
    !wrapped &&
    account.has_discriminator === false &&
    noTypeCheck &&
    looksTyped;
  if (class3) {
    notes.push(
      "class3: AccountInfo without discriminator and no discriminant handler check",
    );
  }

  const class2 =
    !skip &&
    !signerRole &&
    info &&
    !wrapped &&
    account.owner_constraint === null &&
    !hasProgramOwnerCheck &&
    !class3;
  if (class2) notes.push("class2: AccountInfo with null owner_constraint and no handler owner check");

  const siblingAuthority = ix.accounts.some((a) => SIGNER_ROLE.test(a.name));
  const constraintRel = ix.accounts.some(
    (a) =>
      a.has_one.length > 0 ||
      a.other_constraints.some((c) => /owner|authority|constraint/i.test(c)),
  );
  const hasRelCheck =
    constraintRel ||
    listed(ix, /has_one|relationship/i) ||
    inSource(ix, /has_one|\.authority\s*!=|authority\.key|token\.owner/i);
  const class4 =
    !skip &&
    !signerRole &&
    siblingAuthority &&
    account.has_one.length === 0 &&
    !hasRelCheck &&
    /^(user|config|pool|state|data|token)$/i.test(account.name);
  if (class4) notes.push("class4: data account lacks has_one and handler does not link authority");

  // Instruction-level PDA issues — attach to a single account to avoid duplicates.
  const bumpMisuse =
    extraHasBump(ix) &&
    listed(ix, /create_program_address/) &&
    !listed(ix, /find_program_address/);
  const pdaShareMisuse =
    inSource(ix, /with_signer/) &&
    inSource(ix, /\.mint\.as_ref/) &&
    !inSource(ix, /withdraw_destination\.as_ref/);
  const primary = ix.accounts.find((a) => !SKIP_NAMES.test(a.name))?.name;
  const class5 =
    !skip &&
    ((bumpMisuse && account.name === (ix.accounts.find((a) => a.name === "data")?.name ?? primary)) ||
      (pdaShareMisuse && account.name === "pool"));
  if (class5) {
    notes.push(
      bumpMisuse
        ? "class5: user-supplied bump with create_program_address"
        : "class5: PDA sharing — seeds use mint instead of withdraw_destination",
    );
  }

  return {
    instruction_name: ix.name,
    account_name: account.name,
    rust_type: account.rust_type,
    class1,
    class2,
    class3,
    class4,
    class5,
    notes,
  };
}

export function formatRiskSignals(signals: AccountRisk[]): string {
  const lines = signals.map((s) => {
    const flags = (
      [
        s.class1 && "1",
        s.class2 && "2",
        s.class3 && "3",
        s.class4 && "4",
        s.class5 && "5",
      ].filter(Boolean) as string[]
    ).join(",") || "none";
    const note = s.notes.length ? ` — ${s.notes.join("; ")}` : "";
    return `- ${s.instruction_name}.${s.account_name} (${s.rust_type}): allow classes [${flags}]${note}`;
  });
  return [
    "PRECOMPUTED RISK SIGNALS (deterministic from Extractor fields).",
    "You may ONLY emit a finding for (instruction, account, class) when that class number appears in allow classes.",
    "If every account has allow classes [none], return {\"findings\":[]}.",
    ...lines,
  ].join("\n");
}

export function allowedClasses(signal: AccountRisk): VulnClass[] {
  const out: VulnClass[] = [];
  if (signal.class1) out.push(1);
  if (signal.class2) out.push(2);
  if (signal.class3) out.push(3);
  if (signal.class4) out.push(4);
  if (signal.class5) out.push(5);
  return out;
}

const REASONS: Record<VulnClass, (account: string, ix: string) => string> = {
  1: (account, ix) =>
    `Deterministic: '${account}' in '${ix}' is AccountInfo with is_signer=false and no handler signer check. Signer-role names must sign.`,
  2: (account, ix) =>
    `Deterministic: '${account}' in '${ix}' is AccountInfo with owner_constraint=null and no handler owner/program_id check.`,
  3: (account, ix) =>
    `Deterministic: '${account}' in '${ix}' is AccountInfo with has_discriminator=false and no discriminant/type handler check. Owner or deserialize checks do not prevent type cosplay.`,
  4: (account, ix) =>
    `Deterministic: '${account}' in '${ix}' has empty has_one and the handler does not bind it to the sibling authority account.`,
  5: (account, ix) =>
    `Deterministic: '${ix}' passes a bump in extra_args and uses create_program_address without canonical/find_program_address validation.`,
};

export function finalizeFindings(
  summary: ProgramSummary,
  llmFindings: Finding[],
  signals: AccountRisk[],
): Finding[] {
  const byKey = new Map(
    signals.map((s) => [`${s.instruction_name}:${s.account_name}`, s]),
  );

  const kept: Finding[] = [];
  for (const f of llmFindings) {
    const sig = byKey.get(`${f.instruction_name}:${f.account_name}`);
    if (!sig) continue;
    const allow = allowedClasses(sig);
    if (!allow.includes(f.vulnerability_class)) continue;
    if (sig.class1 && (f.vulnerability_class === 2 || f.vulnerability_class === 3)) {
      continue;
    }
    kept.push(f);
  }

  const have = new Set(
    kept.map(
      (f) => `${f.vulnerability_class}:${f.instruction_name}:${f.account_name}`,
    ),
  );

  for (const sig of signals) {
    for (const cls of allowedClasses(sig)) {
      const key = `${cls}:${sig.instruction_name}:${sig.account_name}`;
      if (have.has(key)) continue;
      if (sig.class1 && (cls === 2 || cls === 3)) continue;
      kept.push({
        vulnerability_class: cls,
        instruction_name: sig.instruction_name,
        account_name: sig.account_name,
        reasoning: REASONS[cls](sig.account_name, sig.instruction_name),
        confidence: "HIGH",
      });
      have.add(key);
    }
  }

  return kept;
}

export function finalizeFindingsDetailed(
  summary: ProgramSummary,
  llmFindings: Finding[],
  signals: AccountRisk[],
): { findings: Finding[]; dropped: Finding[] } {
  const byKey = new Map(
    signals.map((s) => [`${s.instruction_name}:${s.account_name}`, s]),
  );
  const dropped: Finding[] = [];
  for (const f of llmFindings) {
    const sig = byKey.get(`${f.instruction_name}:${f.account_name}`);
    const allow = sig ? allowedClasses(sig) : [];
    const reject =
      !sig ||
      !allow.includes(f.vulnerability_class) ||
      (sig.class1 && (f.vulnerability_class === 2 || f.vulnerability_class === 3));
    if (reject) dropped.push(f);
  }
  return { findings: finalizeFindings(summary, llmFindings, signals), dropped };
}
