import { basename, dirname } from "node:path";
import { loadExtractorCache, saveExtractorCache } from "./cache.js";
import type {
  AccountSummary,
  AccountTypeSummary,
  InstructionSummary,
  ProgramSummary,
} from "./types.js";
import { extractBlock, readUtf8, rel, sha256, stripComments, walkRsFiles } from "./util.js";

interface AccountsStruct {
  name: string;
  accounts: AccountSummary[];
}

export function extractProgram(programDir: string): ProgramSummary {
  const files = walkRsFiles(programDir);
  if (files.length === 0) {
    throw new Error(`Extractor: no .rs files under ${programDir}`);
  }

  const combined = files
    .map((f) => `// FILE: ${rel(programDir, f)}\n${readUtf8(f)}`)
    .join("\n\n");
  const hash = sha256(combined);

  const cached = loadExtractorCache(hash);
  if (cached) return cached;

  const source = stripComments(combined);
  const programId = matchDeclareId(source) ?? "unknown";
  const programName =
    matchModName(source) ?? basename(dirname(programDir)) ?? "unknown";

  const structs = parseAccountsStructs(source);
  if (structs.length === 0) {
    throw new Error(
      `Extractor: no #[derive(Accounts)] structs in ${programDir} — refusing to guess`,
    );
  }

  const handlers = parseHandlers(source);
  const structByName = new Map(structs.map((s) => [s.name, s]));
  const instructions: InstructionSummary[] = handlers.map((h) => {
    const accountsStruct = structByName.get(h.accountsStruct);
    if (!accountsStruct) {
      throw new Error(
        `Extractor: instruction ${h.name} references unknown accounts struct ${h.accountsStruct}`,
      );
    }
    const summary = buildConstraintSummary(accountsStruct.accounts, h.checks);
    return {
      name: h.name,
      accounts_struct: h.accountsStruct,
      extra_args: h.extraArgs,
      accounts: accountsStruct.accounts,
      handler_checks: h.checks,
      constraint_summary: summary,
      handler_source: h.body.slice(0, 2000),
    };
  });

  if (instructions.length === 0) {
    throw new Error(`Extractor: no instruction handlers in ${programDir}`);
  }

  const result: ProgramSummary = {
    program_id: programId,
    program_name: programName,
    source_files: files.map((f) => rel(programDir, f)),
    source_hash: hash,
    instructions,
    account_types: parseAccountTypes(source),
  };
  saveExtractorCache(result);
  return result;
}

function matchDeclareId(source: string): string | null {
  return source.match(/declare_id!\s*\(\s*"([^"]+)"\s*\)/)?.[1] ?? null;
}

function matchModName(source: string): string | null {
  return source.match(/#\[program\]\s*pub\s+mod\s+(\w+)/)?.[1] ?? null;
}

function parseAccountsStructs(source: string): AccountsStruct[] {
  const out: AccountsStruct[] = [];
  const re = /#\[derive\s*\(\s*Accounts\s*\)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const after = source.slice(match.index);
    const structMatch = after.match(
      /#\[derive\s*\(\s*Accounts\s*\)\][\s\S]*?pub\s+struct\s+(\w+)\s*(?:<[^>]*>)?\s*\{/,
    );
    if (!structMatch || structMatch.index === undefined) continue;
    const name = structMatch[1];
    const open = match.index + structMatch[0].length - 1;
    const block = extractBlock(source, open);
    const inner = block.slice(1, -1);
    out.push({ name, accounts: parseAccountFields(inner) });
  }
  return out;
}

function parseAccountFields(inner: string): AccountSummary[] {
  const fields: AccountSummary[] = [];
  const chunks = splitTopLevel(inner, ",");
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const attrs: string[] = [];
    let rest = chunk;
    const attrRe = /#\[account\s*\(([\s\S]*?)\)\]/g;
    let attrMatch: RegExpExecArray | null;
    while ((attrMatch = attrRe.exec(chunk))) {
      attrs.push(attrMatch[1]);
    }
    rest = chunk.replace(/#\[[^\]]*\]/g, " ").trim();
    const fieldMatch = rest.match(/^(?:pub\s+)?(\w+)\s*:\s*([\s\S]+)$/);
    if (!fieldMatch) continue;
    const name = fieldMatch[1];
    const rustType = collapseWs(fieldMatch[2]);
    fields.push(summarizeField(name, rustType, attrs));
  }
  return fields;
}

function summarizeField(
  name: string,
  rustType: string,
  attrs: string[],
): AccountSummary {
  const joined = attrs.join(", ");
  const tokens = splitTopLevel(joined, ",").map((t) => t.trim()).filter(Boolean);
  const has_one: string[] = [];
  const other: string[] = [];
  let is_signer = /^Signer\s*</.test(rustType);
  let is_mut = false;
  let owner_constraint: string | null = null;
  let seeds: string | null = null;

  const isAnchorAccount = /^Account\s*</.test(rustType) || /^Box\s*<\s*Account\s*</.test(rustType);
  const isProgram = /^Program\s*</.test(rustType);
  const hasDiscriminator = isAnchorAccount || isProgram;

  if (isAnchorAccount) {
    owner_constraint = "program_id (Anchor Account<> wrapper)";
  }

  for (const tok of tokens) {
    if (tok === "signer") is_signer = true;
    else if (tok === "mut") is_mut = true;
    else if (tok.startsWith("has_one")) {
      const rhs = tok.split("=")[1]?.trim();
      if (rhs) has_one.push(rhs);
    } else if (tok.startsWith("owner")) {
      owner_constraint = tok.split("=")[1]?.trim() ?? tok;
    } else if (tok.startsWith("seeds")) {
      seeds = tok;
    } else if (tok.length) {
      other.push(tok);
    }
  }

  return {
    name,
    rust_type: rustType,
    is_signer,
    is_mut,
    owner_constraint,
    has_one,
    seeds,
    has_discriminator: hasDiscriminator,
    other_constraints: other,
  };
}

function parseHandlers(source: string): {
  name: string;
  accountsStruct: string;
  extraArgs: string[];
  body: string;
  checks: string[];
}[] {
  const out: {
    name: string;
    accountsStruct: string;
    extraArgs: string[];
    body: string;
    checks: string[];
  }[] = [];
  const re =
    /pub\s+fn\s+(\w+)\s*\(\s*ctx\s*:\s*Context\s*<\s*(\w+)\s*>\s*([^)]*)\)\s*(?:->\s*[^{]+)?\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[1];
    const accountsStruct = match[2];
    const extraArgs = parseExtraArgs(match[3] ?? "");
    const open = match.index + match[0].length - 1;
    const block = extractBlock(source, open);
    const body = block.slice(1, -1).trim();
    out.push({
      name,
      accountsStruct,
      extraArgs,
      body,
      checks: collectHandlerChecks(body),
    });
  }
  return out;
}

function parseExtraArgs(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => collapseWs(s));
}

function collectHandlerChecks(body: string): string[] {
  const checks: string[] = [];
  const patterns: [RegExp, string][] = [
    [/\.is_signer/, "is_signer checked in handler"],
    [
      /ctx\.accounts\.\w+\.owner\b/,
      "program owner compared in handler (AccountInfo.owner)",
    ],
    [/spl_token::ID|token::ID/, "token-program id owner check in handler"],
    [/discriminant/, "manual discriminant/type check in handler"],
    [/try_from_slice/, "manual Borsh deserialize (try_from_slice)"],
    [/create_program_address/, "create_program_address used (non-canonical bump possible)"],
    [/find_program_address/, "find_program_address used"],
    [/with_signer/, "CPI with_signer (PDA seeds)"],
    [/MissingRequiredSignature/, "MissingRequiredSignature error path"],
    [/IllegalOwner/, "IllegalOwner error path"],
  ];
  for (const [re, label] of patterns) {
    if (re.test(body)) checks.push(label);
  }
  return checks;
}

function parseAccountTypes(source: string): AccountTypeSummary[] {
  const types: AccountTypeSummary[] = [];
  const re = /(#\[account\]\s*)?(?:#\[[^\]]+\]\s*)*pub\s+struct\s+(\w+)\s*(?:<[^>]*>)?\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const name = match[2];
    if (types.some((t) => t.name === name)) continue;
    const prefix = source.slice(Math.max(0, match.index - 200), match.index);
    const hasAnchor = /#\[account\]/.test(match[0]) || /#\[account\]/.test(prefix);
    const open = match.index + match[0].length - 1;
    let inner = "";
    try {
      inner = extractBlock(source, open).slice(1, -1);
    } catch {
      continue;
    }
    const fields = splitTopLevel(inner, ",")
      .map((f) => collapseWs(f.replace(/#\[[^\]]*\]/g, " ")))
      .filter(Boolean);
    types.push({
      name,
      has_anchor_discriminator: hasAnchor,
      fields,
    });
  }
  return types;
}

function buildConstraintSummary(
  accounts: AccountSummary[],
  checks: string[],
): string {
  const parts: string[] = [];
  for (const a of accounts) {
    const bits: string[] = [a.rust_type];
    if (a.is_signer) bits.push("signer");
    if (a.is_mut) bits.push("mut");
    if (a.owner_constraint) bits.push(`owner=${a.owner_constraint}`);
    if (a.has_one.length) bits.push(`has_one=${a.has_one.join("|")}`);
    if (a.seeds) bits.push(a.seeds);
    if (a.has_discriminator) bits.push("anchor-discriminator");
    parts.push(`${a.name}: ${bits.join(", ")}`);
  }
  if (checks.length) parts.push(`handler: ${checks.join("; ")}`);
  return parts.join(" | ");
}

function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(" || ch === "<" || ch === "{") depth++;
    else if (ch === ")" || ch === ">" || ch === "}") depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(input.slice(start, i));
      start = i + 1;
    }
  }
  out.push(input.slice(start));
  return out;
}

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
