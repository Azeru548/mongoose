import "dotenv/config";
import { join } from "node:path";
import { discoverCases, selectCases, singleProgramCase } from "./dataset.js";
import { extractProgram } from "./extractor.js";
import { writeComparison } from "./evaluate.js";
import { requireGroqApiKey } from "./llm.js";
import { runOtterCase, runSuite } from "./pipeline.js";
import { renderCaseReport } from "./report.js";
import { runSelftest } from "./selftest.js";
import { flag, parseArgs, writeJson } from "./util.js";

const FAMILIES_V1 = [
  "0-signer-authorization",
  "2-owner-checks",
  "3-type-cosplay",
  "1-account-data-matching",
  "7-bump-seed-canonicalization",
  "8-pda-sharing",
];

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  switch (args.command) {
    case "selftest":
      runSelftest();
      return;
    case "extract":
      await cmdExtract(args.program ?? args.dataset);
      return;
    case "otter":
      requireGroqApiKey();
      await cmdOtter(args);
      return;
    case "baseline":
      requireGroqApiKey();
      await cmdBaseline(args);
      return;
    case "evaluate":
      cmdEvaluate(args);
      return;
    case "help":
    default:
      printHelp();
  }
}

async function cmdExtract(target: string | undefined): Promise<void> {
  if (!target) {
    throw new Error("extract requires --program <dir> or --dataset <dir>");
  }
  const summary = extractProgram(target);
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
}

function loadCases(args: ReturnType<typeof parseArgs>) {
  const dataset = flag("dataset", args.dataset, join("data", "sealevel-attacks"));
  return selectCases(discoverCases(dataset), {
    inScope: args.inScope,
    families: args.families,
    limit: args.limit,
  });
}

async function cmdOtter(args: ReturnType<typeof parseArgs>): Promise<void> {
  if (args.program) {
    const result = await runOtterCase(singleProgramCase(args.program), {
      skipVerify: args.skipVerify,
    });
    const out = flag("output", args.output, join("output", "otter_one.json"));
    writeJson(out, result);
    process.stdout.write(renderCaseReport(result) + "\n");
    return;
  }
  const cases = loadCases(args);
  process.stderr.write(`otter: ${cases.length} case(s)\n`);
  const out = flag("output", args.output, "otter_iter1.json");
  await runSuite(cases, "otter", out, { skipVerify: args.skipVerify });
}

async function cmdBaseline(args: ReturnType<typeof parseArgs>): Promise<void> {
  const cases = loadCases(args);
  process.stderr.write(`baseline: ${cases.length} case(s)\n`);
  const out = flag("output", args.output, "baseline_results.json");
  await runSuite(cases, "baseline", out);
}

function cmdEvaluate(args: ReturnType<typeof parseArgs>): void {
  const baseline = flag("baseline", args.baseline, "baseline_results.json");
  const otter = flag("otter", args.otter, "otter_iter1.json");
  const out = flag("output", args.output, "comparison_table.md");
  writeComparison(baseline, otter, out);
}

function printHelp(): void {
  const families = FAMILIES_V1.join(",");
  process.stdout.write(`Otter — prove Solana vulnerabilities, don't just guess them.

Commands:
  npm run selftest
  npm run extract -- --program <dir>
  npm run otter -- --families ${families} --skip-verify --output otter_iter1.json
  npm run baseline -- --families ${families} --output baseline_results.json
  npm run evaluate -- --baseline baseline_results.json --otter otter_iter1.json --output comparison_table.md

Flags:
  --families a,b,c   only these program families
  --in-scope         alias for the 6 v1 families
  --limit N          first N selected cases
  --skip-verify      Detector only (no validator)
`);
}

main().catch((err) => {
  process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + "\n");
  process.exit(1);
});
