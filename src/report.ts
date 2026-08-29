import type { CaseResult, VerifiedFinding } from "./types.js";

export function renderCaseReport(result: CaseResult): string {
  const lines: string[] = [];
  lines.push(`# Otter report: ${result.id}`);
  lines.push("");
  if (result.extractor_error) {
    lines.push(`Extractor failed: ${result.extractor_error}`);
    return lines.join("\n");
  }
  if (result.api_error) {
    lines.push(`xAI API failed: ${result.api_error}`);
    return lines.join("\n");
  }

  const proven = result.findings.filter((f) => f.verdict === "PROVEN");
  const suspected = result.findings.filter((f) => f.verdict !== "PROVEN");

  if (proven.length === 0 && suspected.length === 0) {
    lines.push("No candidate vulnerabilities.");
    return lines.join("\n");
  }

  for (const f of proven) lines.push(renderFinding("PROVEN", f));
  for (const f of suspected) lines.push(renderFinding("SUSPECTED", f));
  return lines.join("\n");
}

function renderFinding(tier: string, f: VerifiedFinding): string {
  return [
    `## [${tier}] Class ${f.vulnerability_class} in \`${f.instruction_name}\``,
    `Location: instruction \`${f.instruction_name}\`, account \`${f.account_name}\``,
    `Confidence: ${f.confidence}`,
    `Reasoning: ${f.reasoning}`,
    f.exploit_transaction
      ? `Evidence: Transaction ${f.exploit_transaction}`
      : `Verifier: ${f.notes}`,
    "",
  ].join("\n");
}
