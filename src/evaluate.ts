import { readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CaseResult, Finding, VulnClass } from "./types.js";
import { ensureDir } from "./util.js";

export function loadSuite(path: string): CaseResult[] {
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (Array.isArray(raw)) return raw as CaseResult[];
  if (raw && typeof raw === "object" && "results" in raw) {
    return (raw as { results: CaseResult[] }).results;
  }
  throw new Error(`unrecognized suite JSON: ${path}`);
}

function classHits(r: CaseResult) {
  if (r.expected_class === null) return r.findings;
  return r.findings.filter((f) => f.vulnerability_class === r.expected_class);
}

function flagged(r: CaseResult): boolean {
  return r.findings.length > 0;
}

function yesNo(v: boolean): string {
  return v ? "YES" : "NO";
}

export interface Iter1Report {
  programs: number;
  vuln: number;
  fixed: number;
  baselineTp: number;
  baselineFp: number;
  otterTp: number;
  otterFp: number;
  localized: number;
  localizationPct: number;
  apiErrors: number;
  extractErrors: number;
  dropped: { id: string; finding: Finding }[];
  tableMd: string;
  summary: string;
}

export function buildIter1Report(
  baseline: CaseResult[],
  otter: CaseResult[],
): Iter1Report {
  const byId = new Map(baseline.map((r) => [r.id, r]));
  const rows: string[] = [
    "| Family | Variant | Baseline Flagged? | Otter Flagged? | Otter Class Correct? | Instruction Name |",
    "|---|---|---|---|---|---|",
  ];

  let vuln = 0;
  let fixed = 0;
  let baselineTp = 0;
  let baselineFp = 0;
  let otterTp = 0;
  let otterFp = 0;
  let localized = 0;
  const dropped: { id: string; finding: Finding }[] = [];

  const otterSorted = [...otter].sort((a, b) => a.id.localeCompare(b.id));

  for (const o of otterSorted) {
    const b = byId.get(o.id);
    const baseFlag = b ? flagged(b) : false;
    const otterFlag = flagged(o);
    const hits = classHits(o);

    let classCell: string;
    if (o.label === "vulnerable") classCell = yesNo(hits.length > 0);
    else classCell = otterFlag && hits.length > 0 ? "NO" : "N/A";

    const instruction =
      hits.find((f) => f.instruction_name && f.instruction_name !== "unknown")
        ?.instruction_name ??
      o.findings[0]?.instruction_name ??
      "—";

    rows.push(
      `| ${o.family} | ${o.variant} | ${yesNo(baseFlag)} | ${yesNo(otterFlag)} | ${classCell} | ${instruction} |`,
    );

    for (const d of o.dropped_findings ?? []) {
      dropped.push({ id: o.id, finding: d });
    }

    if (o.label === "vulnerable") {
      vuln++;
      if (baseFlag) baselineTp++;
      if (hits.length > 0) {
        otterTp++;
        if (instruction !== "—" && instruction !== "unknown") localized++;
      }
    } else {
      fixed++;
      if (b && classHits(b).length > 0) baselineFp++;
      if (hits.length > 0) otterFp++;
    }
  }

  // Baseline FP/TP for expected-class semantics when baseline has expected_class
  baselineTp = 0;
  baselineFp = 0;
  for (const o of otterSorted) {
    const b = byId.get(o.id);
    if (!b) continue;
    if (o.label === "vulnerable") {
      if (flagged(b)) baselineTp++;
    } else if (flagged(b)) {
      // baseline has no reliable class; count any flag on fixed as FP
      baselineFp++;
    }
  }

  const apiErrors =
    otter.filter((r) => r.api_error).length + baseline.filter((r) => r.api_error).length;
  const extractErrors = otter.filter((r) => r.extractor_error).length;
  const localizationPct =
    otterTp === 0 ? 0 : Math.round((localized / otterTp) * 1000) / 10;
  const changelogReady =
    otter.length >= 18 &&
    baseline.length >= 18 &&
    extractErrors === 0 &&
    otterTp === vuln &&
    otterFp === 0
      ? "YES"
      : "NO";

  const droppedLines =
    dropped.length === 0
      ? ["  (none)"]
      : dropped.map(
          (d) =>
            `  - ${d.id}: dropped class ${d.finding.vulnerability_class} ${d.finding.instruction_name}.${d.finding.account_name}`,
        );

  const summary = [
    "=== OTTER ITERATION 2 SUMMARY ===",
    `Programs evaluated: ${otter.length}`,
    `In-scope vulnerable: ${vuln} (insecure variants of the 6 families)`,
    `In-scope fixed: ${fixed} (secure + recommended variants)`,
    `Baseline TP: ${baselineTp}/${vuln} | FP: ${baselineFp}/${fixed}`,
    `Otter TP: ${otterTp}/${vuln} | FP: ${otterFp}/${fixed}`,
    `Otter localization accuracy: ${localizationPct}%`,
    `API errors: ${apiErrors} | Extraction failures: ${extractErrors}`,
    "Dropped findings by validation filter:",
    ...droppedLines,
    `Changelog ready: ${changelogReady}`,
    "",
  ].join("\n");

  const tableMd = [
    "# Otter iteration 2 comparison",
    "",
    rows.join("\n"),
    "",
    "## Aggregates",
    "",
    `| Metric | Baseline | Otter |`,
    `|---|---|---|`,
    `| True positives | ${baselineTp}/${vuln} | ${otterTp}/${vuln} |`,
    `| False positives | ${baselineFp}/${fixed} | ${otterFp}/${fixed} |`,
    `| Localization (instruction_name ≠ unknown) | n/a | ${localizationPct}% |`,
    "",
    "## Dropped findings (validation filter)",
    "",
    dropped.length === 0
      ? "_None._"
      : dropped
          .map(
            (d) =>
              `- \`${d.id}\`: class ${d.finding.vulnerability_class} \`${d.finding.instruction_name}.${d.finding.account_name}\` — ${d.finding.reasoning}`,
          )
          .join("\n"),
    "",
    "```",
    summary.trimEnd(),
    "```",
    "",
  ].join("\n");

  return {
    programs: otter.length,
    vuln,
    fixed,
    baselineTp,
    baselineFp,
    otterTp,
    otterFp,
    localized,
    localizationPct,
    apiErrors,
    extractErrors,
    dropped,
    tableMd,
    summary,
  };
}

export function writeComparison(
  baselinePath: string,
  otterPath: string,
  outputMd: string,
): Iter1Report {
  const report = buildIter1Report(loadSuite(baselinePath), loadSuite(otterPath));
  const dir = dirname(outputMd);
  if (dir && dir !== ".") ensureDir(dir);
  writeFileSync(outputMd, report.tableMd, "utf8");
  process.stdout.write(report.summary);
  return report;
}
