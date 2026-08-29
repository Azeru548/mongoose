import { extractProgram } from "./extractor.js";
import { detect, loadFalsePositiveMemory } from "./detector.js";
import { defaultVerifierContext, verifyFindings } from "./verifier.js";
import type { VerifierContext } from "./verifier.js";
import { runBaselineOnCase } from "./baseline.js";
import type { CaseResult, DatasetCase } from "./types.js";
import { writeJson } from "./util.js";

function baseResult(
  c: DatasetCase,
  started: number,
): Omit<
  CaseResult,
  "extractor" | "extractor_error" | "api_error" | "findings" | "dropped_findings"
> {
  return {
    id: c.id,
    family: c.family,
    variant: c.variant,
    label: c.label,
    expected_class: c.expected_class,
    in_scope: c.in_scope,
    runtime_ms: Date.now() - started,
  };
}

export async function runOtterCase(
  c: DatasetCase,
  opts: { skipVerify?: boolean } = {},
): Promise<CaseResult> {
  const vctx: VerifierContext = {
    ...defaultVerifierContext(opts.skipVerify ?? false),
    caseId: c.id,
  };
  const started = Date.now();
  let extractor = null as ReturnType<typeof extractProgram> | null;
  try {
    extractor = extractProgram(c.program_dir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`extraction failed: ${message}\n`);
    return {
      ...baseResult(c, started),
      extractor: null,
      extractor_error: message,
      api_error: null,
      findings: [],
      dropped_findings: [],
    };
  }

  try {
    const { findings, dropped } = await detect(
      extractor,
      loadFalsePositiveMemory(),
      c.id,
    );
    const verified = await verifyFindings(extractor, findings, vctx);
    return {
      ...baseResult(c, started),
      extractor,
      extractor_error: null,
      api_error: null,
      findings: verified,
      dropped_findings: dropped,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`API failed: ${message}\n`);
    return {
      ...baseResult(c, started),
      extractor,
      extractor_error: null,
      api_error: message,
      findings: [],
      dropped_findings: [],
    };
  }
}

export async function runBaselineCase(c: DatasetCase): Promise<CaseResult> {
  const started = Date.now();
  try {
    const raw = await runBaselineOnCase(c);
    return {
      ...baseResult(c, started),
      extractor: null,
      extractor_error: null,
      api_error: null,
      findings: raw.map((f) => ({
        ...f,
        verdict: "UNCONFIRMED" as const,
        exploit_transaction: null,
        pre_state: null,
        post_state: null,
        notes: "baseline has no verifier",
      })),
      dropped_findings: [],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`API failed: ${message}\n`);
    return {
      ...baseResult(c, started),
      extractor: null,
      extractor_error: null,
      api_error: message,
      findings: [],
      dropped_findings: [],
    };
  }
}

export async function runSuite(
  cases: DatasetCase[],
  kind: "otter" | "baseline",
  output: string,
  opts: { skipVerify?: boolean } = {},
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stderr.write(`[${kind}] ${c.id} ... `);
    const result =
      kind === "otter" ? await runOtterCase(c, opts) : await runBaselineCase(c);
    const n = result.findings.length;
    const err = result.extractor_error
      ? ` EXTRACT ${result.extractor_error}`
      : result.api_error
        ? ` API ${result.api_error}`
        : "";
    process.stderr.write(`${n} finding(s)${err} (${result.runtime_ms}ms)\n`);
    results.push(result);
    writeJson(output, results);
  }
  process.stderr.write(`wrote ${output} (${results.length} cases)\n`);
  return results;
}
