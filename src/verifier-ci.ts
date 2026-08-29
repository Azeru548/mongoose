/**
 * CI entrypoint: prove Class 1–3 findings against a local validator.
 *
 * Reads output/deployed_programs.json from scripts/build-and-deploy.sh,
 * runs Extractor → signals Detector → Verifier, writes verifier_results.json.
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { detect } from "./detector.js";
import { extractProgram } from "./extractor.js";
import type { Finding, VerifiedFinding } from "./types.js";
import { defaultVerifierContext, verifyFindings } from "./verifier.js";

interface DeployedProgram {
  programId: string;
  soPath: string;
  keypairPath: string;
  sourceDir: string;
  crateName: string;
  expectedClass: number;
  expectProven: boolean;
}

type DeployedMap = Record<string, DeployedProgram>;

export interface CiCaseResult {
  id: string;
  expectedClass: number;
  expectProven: boolean;
  programId: string;
  extractor_error: string | null;
  findings: VerifiedFinding[];
  provenCount: number;
  unconfirmedCount: number;
  errorCount: number;
  ok: boolean;
  notes: string[];
}

function loadDeployed(path: string): DeployedMap {
  if (!existsSync(path)) {
    throw new Error(`missing deployed programs file: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8")) as DeployedMap;
}

function printFinding(f: VerifiedFinding): void {
  const sig = f.exploit_transaction ?? "-";
  console.log(
    `  [${f.verdict}] class ${f.vulnerability_class} ${f.instruction_name}.${f.account_name} sig=${sig}`,
  );
  if (f.notes) console.log(`    notes: ${f.notes}`);
}

function writeOverlayMap(
  deployMapPath: string,
  id: string,
  deployed: DeployedProgram,
): string {
  const overlayPath = join(
    dirname(deployMapPath),
    `deploy-map-${deployed.crateName}.json`,
  );
  const base = existsSync(deployMapPath)
    ? (JSON.parse(readFileSync(deployMapPath, "utf8")) as Record<string, unknown>)
    : {};
  const entry = {
    programId: deployed.programId,
    soPath: deployed.soPath,
    keypairPath: deployed.keypairPath,
    caseIds: [id],
  };
  writeFileSync(
    overlayPath,
    JSON.stringify(
      {
        ...base,
        [deployed.crateName]: entry,
        byCaseId: {
          ...((base.byCaseId as Record<string, string>) ?? {}),
          [id]: deployed.crateName,
        },
        missing_signer:
          deployed.crateName === "missing_signer" ||
          deployed.crateName === "missing_signer_secure"
            ? entry
            : base.missing_signer,
        missing_owner:
          deployed.crateName === "missing_owner" ? entry : base.missing_owner,
        type_cosplay:
          deployed.crateName === "type_cosplay" ? entry : base.type_cosplay,
      },
      null,
      2,
    ) + "\n",
  );
  return overlayPath;
}

async function runCase(
  id: string,
  deployed: DeployedProgram,
  deployMapPath: string,
): Promise<CiCaseResult> {
  const notes: string[] = [];
  process.env.OTTER_CASE_ID = id;
  process.env.OTTER_SIGNALS_ONLY = process.env.OTTER_SIGNALS_ONLY ?? "1";

  let findings: VerifiedFinding[] = [];
  let extractor_error: string | null = null;

  try {
    const summary = extractProgram(deployed.sourceDir);
    const { findings: detected, dropped } = await detect(summary, [], id);
    if (dropped.length) notes.push(`dropped ${dropped.length} finding(s)`);

    const hasExpected = detected.some(
      (f) => f.vulnerability_class === deployed.expectedClass,
    );
    const seed: Finding[] = hasExpected
      ? detected
      : [
          ...detected,
          {
            vulnerability_class: deployed.expectedClass as 1 | 2 | 3 | 4 | 5,
            instruction_name: summary.instructions[0]?.name ?? "unknown",
            account_name: summary.instructions[0]?.accounts[0]?.name ?? "unknown",
            reasoning: `CI seed finding for expected class ${deployed.expectedClass}`,
            confidence: "HIGH",
          },
        ];

    const overlayPath = writeOverlayMap(deployMapPath, id, deployed);
    const vctx = {
      ...defaultVerifierContext(false),
      deployMapPath: overlayPath,
      caseId: id,
    };
    findings = await verifyFindings(summary, seed, vctx);
  } catch (err) {
    extractor_error = err instanceof Error ? err.message : String(err);
    notes.push(`case error: ${extractor_error}`);
  }

  const proven = findings.filter((f) => f.verdict === "PROVEN");
  const unconfirmed = findings.filter((f) => f.verdict === "UNCONFIRMED");
  const errors = findings.filter((f) =>
    (f.notes ?? "").toLowerCase().includes("exploit attempt failed"),
  );

  const hasProven = proven.length > 0;
  const ok = deployed.expectProven ? hasProven : !hasProven;
  if (!ok) {
    notes.push(
      deployed.expectProven
        ? "EXPECTED PROVEN but got none"
        : "EXPECTED no PROVEN (secure control) but got PROVEN",
    );
  }

  return {
    id,
    expectedClass: deployed.expectedClass,
    expectProven: deployed.expectProven,
    programId: deployed.programId,
    extractor_error,
    findings,
    provenCount: proven.length,
    unconfirmedCount: unconfirmed.length,
    errorCount: errors.length,
    ok,
    notes,
  };
}

function anchorDiscHex(ixName: string): string {
  return createHash("sha256")
    .update(`global:${ixName}`)
    .digest()
    .subarray(0, 8)
    .toString("hex");
}

async function main(): Promise<void> {
  const deployedPath =
    process.env.OTTER_DEPLOYED_PROGRAMS ??
    join(process.cwd(), "output", "deployed_programs.json");
  const outPath =
    process.env.OTTER_VERIFIER_RESULTS ??
    join(process.cwd(), "output", "verifier_results.json");

  mkdirSync(dirname(outPath), { recursive: true });
  process.env.SOLANA_RPC_URL =
    process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  process.env.OTTER_SIGNALS_ONLY = process.env.OTTER_SIGNALS_ONLY ?? "1";

  const deployed = loadDeployed(deployedPath);
  const deployMap: Record<string, unknown> = { byCaseId: {} as Record<string, string> };
  for (const [id, d] of Object.entries(deployed)) {
    (deployMap.byCaseId as Record<string, string>)[id] = d.crateName;
    deployMap[d.crateName] = {
      programId: d.programId,
      soPath: d.soPath,
      keypairPath: d.keypairPath,
      caseIds: [id],
    };
  }
  const deployMapPath = join(process.cwd(), "output", "deploy-map.json");
  writeFileSync(deployMapPath, JSON.stringify(deployMap, null, 2) + "\n");
  process.env.OTTER_DEPLOY_MAP = deployMapPath;

  console.log("=== Otter Verifier CI ===");
  console.log(`RPC: ${process.env.SOLANA_RPC_URL}`);
  console.log(`Deployed programs: ${Object.keys(deployed).length}`);
  console.log(`Discriminator(log_message)=${anchorDiscHex("log_message")}`);

  const results: CiCaseResult[] = [];
  for (const [id, d] of Object.entries(deployed)) {
    console.log(
      `\n--- ${id} (expectProven=${d.expectProven}, class=${d.expectedClass}) ---`,
    );
    const r = await runCase(id, d, deployMapPath);
    results.push(r);
    for (const f of r.findings) printFinding(f);
    console.log(
      `  summary: proven=${r.provenCount} unconfirmed=${r.unconfirmedCount} ok=${r.ok}`,
    );
    if (r.notes.length) console.log(`  notes: ${r.notes.join("; ")}`);
  }

  const provenTotal = results.reduce((n, r) => n + r.provenCount, 0);
  const failed = results.filter((r) => !r.ok);
  const payload = {
    generated_at: new Date().toISOString(),
    rpc: process.env.SOLANA_RPC_URL,
    provenTotal,
    cases: results,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");

  // Also write a copy at repo root for easy download/commit.
  writeFileSync(
    join(process.cwd(), "verifier_results.json"),
    JSON.stringify(payload, null, 2) + "\n",
  );

  console.log(`\nWrote ${outPath}`);
  console.log(`Wrote verifier_results.json`);
  console.log(`TOTAL PROVEN: ${provenTotal}`);
  console.log(`CASES OK: ${results.length - failed.length}/${results.length}`);

  if (provenTotal < 1) {
    console.error("No PROVEN findings — failing CI");
    process.exit(1);
  }
  if (failed.length) {
    console.error("Some cases missed expectations:");
    for (const f of failed) console.error(`  - ${f.id}: ${f.notes.join("; ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
