import { readFileSync } from "node:fs";
import { join } from "node:path";

interface VerifiedFinding {
  vulnerability_class: number;
  instruction_name: string;
  account_name: string;
  verdict: "PROVEN" | "UNCONFIRMED";
  exploit_transaction: string | null;
  notes: string;
}

interface CaseResult {
  id: string;
  expectedClass: number;
  expectProven: boolean;
  programId: string;
  findings: VerifiedFinding[];
  ok: boolean;
}

interface ResultsFile {
  generated_at: string;
  rpc: string;
  provenTotal: number;
  cases: CaseResult[];
}

const CLASS_NAMES: Record<number, string> = {
  1: "Missing signer check",
  2: "Missing owner check",
  3: "Account type confusion",
  4: "Missing relationship constraint",
  5: "Insecure PDA seeds",
};

function main() {
  const path = process.argv[2] ?? join(process.cwd(), "output", "verifier_results.json");
  const data: ResultsFile = JSON.parse(readFileSync(path, "utf8"));

  console.log("");
  console.log("=".repeat(60));
  console.log("  MONGOOSE — VULNERABILITY VERIFICATION REPORT");
  console.log("=".repeat(60));
  console.log(`  Run: ${data.generated_at}`);
  console.log(`  Total proven exploits: ${data.provenTotal}`);
  console.log("=".repeat(60));

  for (const c of data.cases) {
    console.log("");
    console.log(`Program: ${c.id}`);
    console.log(`Program ID: ${c.programId}`);
    console.log(`Expected: ${c.expectProven ? "vulnerable (should be exploitable)" : "secure (should resist exploit)"}`);
    console.log(`Result: ${c.ok ? "✅ MATCHED EXPECTATION" : "❌ DID NOT MATCH EXPECTATION"}`);

    for (const f of c.findings) {
      const className = CLASS_NAMES[f.vulnerability_class] ?? `Class ${f.vulnerability_class}`;
      console.log("");
      if (f.verdict === "PROVEN") {
        console.log(`  [PROVEN] ${className} — ${f.instruction_name}(${f.account_name})`);
        console.log(`    Exploit transaction: ${f.exploit_transaction}`);
        console.log(`    ${f.notes}`);
      } else {
        console.log(`  [BLOCKED / UNCONFIRMED] ${className} — ${f.instruction_name}(${f.account_name})`);
        console.log(`    ${f.notes}`);
      }
    }
  }

  console.log("");
  console.log("=".repeat(60));
}

main();