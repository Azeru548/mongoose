import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { completeJson, detectorModel } from "./llm.js";
import {
  computeRiskSignals,
  finalizeFindingsDetailed,
  formatRiskSignals,
} from "./signals.js";
import type { FalsePositiveRecord, Finding, ProgramSummary, VulnClass } from "./types.js";

async function throttleDetector(label: string): Promise<void> {
  process.stderr.write(`Calling Groq for ${label}... (delay: 8s)\n`);
}

const FindingSchema = z.object({
  vulnerability_class: z.number().int().min(1).max(5),
  instruction_name: z.string().min(1),
  account_name: z.string().min(1),
  reasoning: z.string().min(1),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
});

const ResponseSchema = z.object({
  findings: z.array(FindingSchema),
});

export const DETECTOR_SYSTEM_PROMPT = `You are a Solana security analyst. You receive a structured JSON summary of an Anchor program. Identify ONLY missing checks from the 5-class taxonomy below.

For each class, check these EXACT Extractor fields:

CLASS 1 — Missing signer check:
- Look at: account.is_signer, account.rust_type, instruction.handler_checks
- Flag ONLY if ALL of these are true:
  1. account.is_signer === false
  2. account.rust_type is "AccountInfo<'info>" (NOT "Signer<'info>")
  3. instruction.handler_checks contains NO string mentioning "signer" or "MissingRequiredSignature"
- If the account is named "authority", "admin", "owner", or "payer", this strongly suggests it SHOULD be a signer. Flag with HIGH confidence.
- Do NOT flag Class 1 if the account is a generic data account (e.g., "token", "vault", "config") that legitimately does not need to sign.

CLASS 2 — Missing owner check:
- Look at: account.owner_constraint, account.rust_type, instruction.handler_checks
- Flag ONLY if ALL of these are true:
  1. account.owner_constraint === null
  2. account.rust_type is "AccountInfo<'info>" (NOT "Account<'info, SomeType>")
  3. instruction.handler_checks contains NO string mentioning "owner", "program_id", or "IllegalOwner"
- Do NOT flag if rust_type is "Account<'info, ...>" because Anchor's Account wrapper already enforces owner.

CLASS 3 — Account type confusion (type cosplay):
- Look at: account.has_discriminator, account.rust_type, instruction.handler_checks
- Flag ONLY if ALL of these are true:
  1. account.has_discriminator === false
  2. account.rust_type is "AccountInfo<'info>" (NOT "Account<'info, SomeType>")
  3. instruction.handler_checks contains NO string mentioning "discriminant", "type check", or "account type"
- Handler checks about "owner" or "deserialize" do NOT count as type confusion prevention. Only checks that explicitly validate the account's type or discriminant count.
- Do NOT flag if rust_type is "Account<'info, ...>" because Anchor's wrapper enforces type via discriminator.

CLASS 4 — Missing relationship constraint (has_one):
- Look at: account.has_one, instruction.handler_checks
- Flag ONLY if:
  1. Two accounts in the same instruction are logically linked (e.g., a "config" with "authority" field and a separate "authority" account)
  2. account.has_one is empty [] for the dependent account
  3. instruction.handler_checks contains NO string mentioning "has_one", "relationship", or comparing the two accounts
- Be very conservative. Only flag if the relationship is obvious from account names.

CLASS 5 — Insecure PDA seeds:
- Look at: account.seeds, instruction.handler_checks, extra_args
- Flag ONLY if:
  1. account.seeds contains user-controlled or static-only seeds (e.g., just a string literal without a unique identifier)
  2. There is no bump seed or the bump is passed as an argument (extra_args contains "bump")
  3. instruction.handler_checks contains NO string mentioning "canonical", "find_program_address", or "validate PDA"
- Be conservative. Static seeds with a bump are usually fine.

OUTPUT RULES:
- Output ONLY findings where ALL conditions for that class are met.
- Do NOT output multiple findings for the same account unless genuinely different vulnerabilities exist.
- If Class 1 applies to an account (especially one named authority, admin, owner, or payer), emit ONLY Class 1 for that account. Do not also emit Class 2 or Class 3 for it.
- Do not flag Class 2 or Class 3 on an account named authority, admin, owner, or payer unless handler_checks show that account is deserialized as typed state (try_from_slice, unpack). A signer/authority AccountInfo is not an owner-check or type-cosplay target.
- Do not flag Class 4 on a Signer/'authority' account just because another account has an authority field. Only flag Class 4 when a data account is missing an obvious has_one link and the handler does not compare keys.
- If uncertain, prefer no finding over a weak finding.
- vulnerability_class must be the integer 1, 2, 3, 4, or 5 (never a class name string).
- confidence must be exactly HIGH, MEDIUM, or LOW (uppercase).
- Output format must be exactly: { findings: [{ vulnerability_class: 1-5, instruction_name, account_name, reasoning: "2-3 sentences", confidence: "HIGH"|"MEDIUM"|"LOW" }] }
- Empty findings is valid: { "findings": [] }
- Do not flag system accounts, token_program, rent, clock, or similar sysvars/programs.
- A PRECOMPUTED RISK SIGNALS block is appended to the user message. Only flag triples listed there as allowed. If none are allowed, return {"findings":[]}.

Known false positives to skip (do not re-flag these):
`;

export function loadFalsePositiveMemory(cwd = process.cwd()): FalsePositiveRecord[] {
  const path = join(cwd, "data", "fp-memory.json");
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) return [];
  return raw as FalsePositiveRecord[];
}

export interface DetectResult {
  findings: Finding[];
  dropped: Finding[];
}

export async function detect(
  summary: ProgramSummary,
  memory: FalsePositiveRecord[] = loadFalsePositiveMemory(),
  label?: string,
): Promise<DetectResult> {
  const memoryBlock =
    memory.length === 0
      ? "(none)"
      : memory
          .map(
            (m) =>
              `- class ${m.vulnerability_class} ${m.instruction_name}.${m.account_name}: ${m.reason}`,
          )
          .join("\n");

  const signals = computeRiskSignals(summary);
  const user = [
    formatRiskSignals(signals),
    "",
    "PROGRAM SUMMARY:",
    JSON.stringify(
      {
        program_name: summary.program_name,
        program_id: summary.program_id,
        instructions: summary.instructions.map((ix) => ({
          name: ix.name,
          extra_args: ix.extra_args,
          accounts: ix.accounts,
          handler_checks: ix.handler_checks,
          constraint_summary: ix.constraint_summary,
        })),
        account_types: summary.account_types,
      },
      null,
      2,
    ),
  ].join("\n");

  await throttleDetector(label ?? summary.program_name);

  // CI can set OTTER_SIGNALS_ONLY=1 to skip Groq and rely on deterministic signals.
  if (process.env.OTTER_SIGNALS_ONLY === "1" || process.env.OTTER_SIGNALS_ONLY === "true") {
    process.stderr.write("OTTER_SIGNALS_ONLY=1 — skipping Detector LLM\n");
    return finalizeFindingsDetailed(summary, [], signals);
  }

  let llmFindings: Finding[] = [];
  try {
    const text = await completeJson({
      model: detectorModel(),
      system: DETECTOR_SYSTEM_PROMPT + memoryBlock,
      user,
    });
    llmFindings = parseFindings(text, memory);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Detector LLM failed (${msg}); using deterministic signals only\n`);
  }
  return finalizeFindingsDetailed(summary, llmFindings, signals);
}

export function parseFindings(
  text: string,
  memory: FalsePositiveRecord[] = [],
): Finding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    process.stderr.write(`Detector JSON parse failed. Raw response:\n${text}\n`);
    throw new Error("Detector: invalid JSON (raw response logged)");
  }

  const unwrapped =
    parsed && typeof parsed === "object" && "findings" in (parsed as object)
      ? parsed
      : { findings: Array.isArray(parsed) ? parsed : [parsed] };

  const coerced = {
    findings: Array.isArray((unwrapped as { findings: unknown }).findings)
      ? (unwrapped as { findings: unknown[] }).findings.map(coerceFinding)
      : [],
  };

  let findings;
  try {
    findings = ResponseSchema.parse(coerced).findings;
  } catch (err) {
    process.stderr.write(`Detector schema failed. Raw response:\n${text}\n`);
    throw new Error(
      `Detector: JSON did not match Finding[] schema (${err instanceof Error ? err.message : String(err)})`,
    );
  }
  const skip = new Set(
    memory.map(
      (m) => `${m.vulnerability_class}:${m.instruction_name}:${m.account_name}`,
    ),
  );

  return findings
    .filter(
      (f) =>
        !skip.has(`${f.vulnerability_class}:${f.instruction_name}:${f.account_name}`),
    )
    .map((f) => ({
      ...f,
      vulnerability_class: f.vulnerability_class as VulnClass,
    }));
}

function coerceFinding(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const o = { ...(raw as Record<string, unknown>) };
  const cls = o.vulnerability_class;
  if (typeof cls === "string") {
    const t = cls.toLowerCase();
    if (/\bsigner\b/.test(t) || t === "1") o.vulnerability_class = 1;
    else if (/\bowner\b/.test(t) || t === "2") o.vulnerability_class = 2;
    else if (/type|cosplay|confusion|discriminant/.test(t) || t === "3") {
      o.vulnerability_class = 3;
    } else if (/has_one|relationship/.test(t) || t === "4") o.vulnerability_class = 4;
    else if (/\bpda\b|seed/.test(t) || t === "5") o.vulnerability_class = 5;
    else {
      const n = Number(cls);
      if (Number.isInteger(n)) o.vulnerability_class = n;
    }
  }
  if (typeof o.confidence === "string") {
    o.confidence = o.confidence.toUpperCase();
  } else if (typeof o.confidence === "number") {
    o.confidence = o.confidence >= 0.67 ? "HIGH" : o.confidence >= 0.34 ? "MEDIUM" : "LOW";
  }
  return o;
}
