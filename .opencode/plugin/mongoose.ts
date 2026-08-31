import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"

import { existsSync, readFileSync } from "node:fs"
import { join, isAbsolute, resolve } from "node:path"

/**
 * Mongoose OpenCode plugin — wraps Extractor + Detector in --skip-verify mode.
 * Does NOT touch Verifier / validator logic.
 */

const CLASS_NAMES: Record<number, string> = {
  1: "Missing signer check",
  2: "Missing owner check",
  3: "Account type confusion",
  4: "Missing relationship constraint",
  5: "Insecure PDA seeds",
}

function formatFindings(findings: Array<{ vulnerability_class: number; instruction_name: string; account_name: string; confidence: string; reasoning: string }>): string {
  if (findings.length === 0) {
    return "No findings — all checked accounts have required constraints.\n"
  }
  const lines: string[] = []
  lines.push(`Found ${findings.length} finding(s):\n`)
  for (const f of findings) {
    const name = CLASS_NAMES[f.vulnerability_class] ?? `Class ${f.vulnerability_class}`
    lines.push(`- [Class ${f.vulnerability_class}: ${name}] ${f.instruction_name}.${f.account_name} (${f.confidence})`)
    lines.push(`  Reasoning: ${f.reasoning}`)
  }
  return lines.join("\n") + "\n"
}

function formatVerifierReport(data: { generated_at: string; provenTotal: number; cases: Array<{ id: string; programId: string; expectProven: boolean; ok: boolean; findings: Array<{ vulnerability_class: number; instruction_name: string; account_name: string; verdict: string; exploit_transaction: string | null; notes: string }> }> }): string {
  const out: string[] = []
  out.push("")
  out.push("=".repeat(60))
  out.push("  MONGOOSE — VULNERABILITY VERIFICATION REPORT")
  out.push("=".repeat(60))
  out.push(`  Run: ${data.generated_at}`)
  out.push(`  Total proven exploits: ${data.provenTotal}`)
  out.push("=".repeat(60))
  for (const c of data.cases) {
    out.push("")
    out.push(`Program: ${c.id}`)
    out.push(`Program ID: ${c.programId}`)
    out.push(`Expected: ${c.expectProven ? "vulnerable (should be exploitable)" : "secure (should resist exploit)"}`)
    out.push(`Result: ${c.ok ? "✅ MATCHED EXPECTATION" : "❌ DID NOT MATCH EXPECTATION"}`)
    for (const f of c.findings) {
      const className = CLASS_NAMES[f.vulnerability_class] ?? `Class ${f.vulnerability_class}`
      out.push("")
      if (f.verdict === "PROVEN") {
        out.push(`  [PROVEN] ${className} — ${f.instruction_name}(${f.account_name})`)
        out.push(`    Exploit transaction: ${f.exploit_transaction}`)
        out.push(`    ${f.notes}`)
      } else {
        out.push(`  [BLOCKED / UNCONFIRMED] ${className} — ${f.instruction_name}(${f.account_name})`)
        out.push(`    ${f.notes}`)
      }
    }
  }
  out.push("")
  out.push("=".repeat(60))
  return out.join("\n") + "\n"
}

export default (async ({ directory, worktree }) => {
  return {
    tool: {
      mongoose_detect: tool({
        description:
          "Run Mongoose Extractor + Detector (signals-only, no validator) on an Anchor/Solana program. Give a directory path (e.g. data/sealevel-attacks/programs/0-signer-authorization/insecure/src or fixtures/programs/missing_signer). Returns HIGH-confidence findings only.",
        args: {
          programPath: tool.schema.string().describe("Path to Anchor/Solana program source directory (e.g. fixtures/programs/missing_signer or data/sealevel-attacks/programs/0-signer-authorization/insecure/src)"),
        },
        async execute(args, ctx) {
          const raw = args.programPath
          const base = ctx.directory || directory || worktree || process.cwd()
          const fullPath = isAbsolute(raw) ? raw : resolve(base, raw)

          if (!existsSync(fullPath)) {
            return `Error: path does not exist: ${fullPath}\nResolved from: ${raw} (base: ${base})`
          }

          const prev = process.env.OTTER_SIGNALS_ONLY
          process.env.OTTER_SIGNALS_ONLY = "1"
          try {
            // Dynamic import to avoid loading at plugin init time (keeps opencode startup fast and avoids ESM cycle issues)
            const { extractProgram } = await import("../../src/extractor.js")
            const { detect } = await import("../../src/detector.js")

            let summary: any
            try {
              summary = extractProgram(fullPath)
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e)
              return `Extractor failed for ${fullPath}:\n${msg}\n\nThis usually means no #[derive(Accounts)] structs were found — check the path points at the program's src/ directory.`
            }

            const label = `mongoose_detect:${fullPath}`
            const { findings } = await detect(summary, [], label)

            const header = [
              `Mongoose detect — ${fullPath}`,
              `Program: ${summary.program_name} (${summary.program_id})`,
              `Instructions: ${summary.instructions.map((i: any) => i.name).join(", ") || "(none)"}`,
              "",
            ].join("\n")

            return header + formatFindings(findings)
          } catch (e) {
            const msg = e instanceof Error ? e.message + "\n" + (e.stack ?? "") : String(e)
            return `mongoose_detect failed: ${msg}`
          } finally {
            if (prev === undefined) delete process.env.OTTER_SIGNALS_ONLY
            else process.env.OTTER_SIGNALS_ONLY = prev
          }
        },
      }),
    },

    // Handle slash command /mongoose:report (and /mongoose-report)
    "command.execute.before": async (input, output) => {
      const cmd = input.command?.replace(/^\//, "") ?? ""
      if (cmd !== "mongoose:report" && cmd !== "mongoose-report" && cmd !== "mongoose_report") return

      const base = worktree || directory || process.cwd()
      const candidates = [
        join(base, "output", "verifier_results.json"),
        join(base, "verifier_results.json"),
        join(process.cwd(), "output", "verifier_results.json"),
      ]
      let path = candidates.find((p) => existsSync(p))
      let data: any = null
      let err: string | null = null
      if (!path) {
        err = `No verifier results found.\n\nChecked:\n${candidates.map((p) => `  - ${p}`).join("\n")}\n\nTo generate it, run the full verifier pipeline on a machine with solana-test-validator:\n  solana-test-validator --reset --quiet &\n  ./scripts/build-and-deploy.sh\n  OTTER_SIGNALS_ONLY=1 npm run verify:ci\n\nSee README.md "CI Verifier" and "Reproduction Guide" (or output/verifier_results.json artifact from GitHub Actions) for details.\n`
      } else {
        try {
          data = JSON.parse(readFileSync(path, "utf8"))
        } catch (e) {
          err = `Failed to read ${path}: ${e instanceof Error ? e.message : String(e)}`
        }
      }

      const text = err ?? formatVerifierReport(data)
      // Output as a text part so OpenCode renders it in conversation
      output.parts = [{ type: "text", text } as any]
    },
  }
}) satisfies Plugin
