<p align="center">
  <img src="logo-removebg-preview.png" alt="Mongoose Logo" width="200" />
</p>

# Mongoose

**Every scanner tells you "this looks broken." Mongoose shows you the transaction that broke it.**

Mongoose is a three-stage agent for solo Anchor developers: it extracts a structured account map, flags Solana-specific holes, then tries to *prove* them with a real transaction on a local validator. Findings are **Proven** (exploit landed) or **Suspected** (flagged, not confirmed).

Hackathon: micro1 Agentic Workflows.

## Who it is for

Solo / small-team Anchor developers shipping without a $15k audit. The bottleneck is not "more warnings" — it is unverified scanner output.

## Pipeline

1. **Extractor** (no LLM) — tree-walk / regex parse of `#[derive(Accounts)]`, field types, `#[account(...)]`, and handler-body checks (`is_signer`, owner compares, discriminants, PDA derivation).
2. **Detector** (one structured Grok call) — 5-class taxonomy over that JSON. Not Claude Code / OpenCode / Grok Build.
3. **Verifier** (no LLM) — classes 1–3 attempt an exploit tx on `solana-test-validator`. Classes 4–5 stay Suspected.

Build-time coding agents (Grok Build, etc.) belong in trajectories. They are not the Detector.

## Setup

```bash
node -v          # 20.x
cp .env.example .env   # set GROQ_API_KEY from https://console.groq.com/keys
npm install
```

Dataset (already cloned in this workspace):

```bash
npm run setup:dataset
# → data/sealevel-attacks   (coral-xyz/sealevel-attacks)
```

The spec named `neodyme-labs/sealevel-attacks`; that repo is not public. The Anchor insecure/secure/recommended pairs live in [coral-xyz/sealevel-attacks](https://github.com/coral-xyz/sealevel-attacks).

Optional verifier: Solana CLI 1.18 + `solana-test-validator` on `http://127.0.0.1:8899`. Without it, findings degrade to UNCONFIRMED — Mongoose will not invent a signature.

## Commands

```bash
npm run selftest

# Extractor only
npm run extract -- --program data/sealevel-attacks/programs/0-signer-authorization/insecure/src

# First eval: 6 in-scope families, detector only (needs a real GROQ_API_KEY in .env)
npm run otter:inscope
npm run baseline:inscope
npm run evaluate -- --baseline ./output/baseline_results.json --otter ./output/otter_results.json
```

Single program:

```bash
npm run otter -- --program path/to/src --skip-verify
```

## v1 vulnerability classes

| # | Class | Verifier |
|---|---|---|
| 1 | Missing signer check | Full (when program is deployed) |
| 2 | Missing owner check | Full |
| 3 | Type cosplay | Full |
| 4 | Missing relationship (`has_one` / account-data matching) | Suspected only |
| 5 | Insecure PDA seeds | Suspected only |

In-scope families in the dataset: `0-signer-authorization`, `2-owner-checks`, `3-type-cosplay`, `1-account-data-matching`, `7-bump-seed-canonicalization`, `8-pda-sharing`. Other families still run; they are excluded from primary TP/FP.

## Detector lock-in

- Provider: Groq Cloud (`GROQ_API_KEY`, `https://api.groq.com/openai/v1`)
- Default model: `openai/gpt-oss-20b` (override `DETECTOR_MODEL`)
- Interface: `detect(summary) → Finding[]` with JSON object response
- False-positive memory: `data/fp-memory.json`

## CI Verifier (GitHub Actions)

Local machines write TypeScript. **ubuntu-latest** builds programs, starts the validator, deploys, runs exploits, and uploads artifacts.

### Run manually from GitHub UI

1. Push this repo to GitHub
2. Open **Actions** → **Mongoose Verifier CI**
3. Click **Run workflow** → **Run workflow**
4. When green, open the run → **Artifacts** → download `mongoose-verifier-results`
5. Commit `verifier_results.json` from the zip into the repo if you want proofs in git

### What the workflow does

| Step | Detail |
|---|---|
| Toolchain | Rust, **Solana CLI 1.18.0**, **Anchor 0.29.0**, Node 20 |
| Build/deploy | `scripts/build-and-deploy.sh` → unique keypairs, patch `declare_id!`, `anchor build`, `solana program deploy` |
| Validator | `solana-test-validator` @ `http://127.0.0.1:8899` (health check) |
| Prove | `npm run verify:ci` (`src/verifier-ci.ts`) — raw `@solana/web3.js` txs (no Anchor `.rpc()`) |
| Artifact | `verifier_results.json`, `deployed_programs.json` |

Programs covered (keep CI &lt; 20 min):

- `0-signer-authorization/insecure` → expect **PROVEN** (Class 1)
- `0-signer-authorization/secure` → expect **UNCONFIRMED** (control)
- `2-owner-checks/insecure` → expect **PROVEN** (Class 2)
- `3-type-cosplay/insecure` → expect **PROVEN** (Class 3)

```bash
# Linux with Solana + Anchor already installed:
solana-test-validator --reset --quiet &
./scripts/build-and-deploy.sh
OTTER_SIGNALS_ONLY=1 npm run verify:ci
```

Fixtures under `fixtures/programs/` are Anchor **0.29** equivalents of sealevel-attacks Classes 1–3 (upstream corpus is Anchor 0.20).

## OpenCode Plugin (Mongoose — detector only, no validator)

Mongoose's **Extractor + Detector** (signals-only, `--skip-verify`) are also exposed as an [OpenCode](https://opencode.ai) plugin so you can run them from any OpenCode session without leaving the TUI. The Verifier/validator flow is **not** wrapped — it stays in `scripts/build-and-deploy.sh` + `npm run verify:ci` and is proven on `main`.

### What the plugin provides

| Surface | Name | What it does |
|---|---|---|
| **Tool** | `mongoose_detect` | Calls `extractProgram(programPath)` (`src/extractor.ts:16`) → `detect(summary)` (`src/detector.ts:104`) with `OTTER_SIGNALS_ONLY=1` set programmatically (deterministic signals, no Groq). Returns a formatted list of `Class / instruction.account (confidence) + reasoning`. |
| **Slash command** | `/mongoose:report` (also `/mongoose-report` hyphen alias) | Reads `output/verifier_results.json` (or `verifier_results.json` at repo root) and prints the same human-readable layout as `src/print-report.ts:37` (`MONGOOSE — VULNERABILITY VERIFICATION REPORT` with `Program / Expected / Result / [PROVEN] Exploit transaction: …` or `[BLOCKED / UNCONFIRMED]`). Reuses that formatter directly — no LLM reimplementation. |

Files: `.opencode/plugin/mongoose.ts:1` (plugin entry, `Plugin` from `@opencode-ai/plugin@1.18.25`), `.opencode/command/mongoose-report.md:1` (slash-command registration, template `$ARGUMENTS` only — hook injects the report). Plugin is auto-discovered from `.opencode/plugin/` (no `opencode.json` entry needed) and loaded once at OpenCode startup.

### Prerequisites

```bash
node -v          # 20.x
npm install      # installs @opencode-ai/plugin, zod, @solana/web3.js, tsx, etc.
# opencode 1.18.x already installed (npm i -g opencode-ai or via npm script)
opencode --version  # 1.18.x
```

No Solana CLI / validator needed for the plugin — it is **skip-verify only**. For the full `PROVEN` flow, see [CI Verifier](#ci-verifier-github-actions).

### Usage — tool `mongoose_detect`

In any OpenCode TUI session (after restart so the new file is picked up):

> **Prompt the agent naturally:** “use mongoose_detect to scan data/sealevel-attacks/programs/0-signer-authorization/insecure/src”

Or directly via the tool API (headless test):

```bash
npx tsx -e "
import pluginFactory from './.opencode/plugin/mongoose.ts';
const plugin = await pluginFactory({directory: process.cwd(), worktree: process.cwd(), client:{}, project:{}, serverUrl: new URL('http://localhost'), \$:{} });
const tool = plugin.tool.mongoose_detect;
const out = await tool.execute({programPath: 'data/sealevel-attacks/programs/0-signer-authorization/insecure/src'}, {directory: process.cwd(), worktree: process.cwd(), sessionID:'t', messageID:'m', agent:'t', abort:new AbortController().signal, metadata:()=>{}, ask:async()=>{}});
console.log(out);
"
```

**Input schema (Zod):** `programPath: string` (required) — path to an Anchor program's `src/` directory. Can be absolute or relative to the session's `directory`/`worktree` (plugin resolves via `isAbsolute`/`resolve`). Examples:

- `data/sealevel-attacks/programs/0-signer-authorization/insecure/src` → **Class 1 HIGH** (`log_message.authority`, `is_signer=false`, `src/signals.ts:66`)
- `data/sealevel-attacks/programs/2-owner-checks/insecure/src` → Class 2
- `data/sealevel-attacks/programs/3-type-cosplay/insecure/src` → Class 3
- `data/sealevel-attacks/programs/1-account-data-matching/insecure/src` → Class 4 (Suspected)
- `fixtures/programs/missing_signer` → **Extractor error** (`no #[derive(Accounts)]` — fixtures are `pinocchio 0.7.1` minimal, not Anchor; `extractor.ts:37` refuses to guess — use sealevel-attacks paths for the tool)

**Output:** header `Mongoose detect — <resolved path> / Program: <name> (<program_id>) / Instructions: …` + `Found N finding(s):` or `No findings — all checked accounts have required constraints.` Each finding: `[Class 1: Missing signer check] log_message.authority (HIGH) / Reasoning: Deterministic: …`. Same `CLASS_NAMES` as `src/print-report.ts:29`.

**Notes:**
- Sets `OTTER_SIGNALS_ONLY=1` programmatically inside `execute` (save/restore `prev`), so the Detector never calls Groq in this tool — pure `signals.ts:46` deterministic.
- Dynamic `import("../../src/extractor.js")` / `import("../../src/detector.js")` (`.js` for `tsx`/`Bun` remap) keeps plugin startup fast and avoids ESM cycles.

### Usage — slash command `/mongoose:report`

```bash
# 1. Generate the file (once, with validator):
solana-test-validator --reset --quiet &
./scripts/build-and-deploy.sh
OTTER_SIGNALS_ONLY=1 npm run verify:ci
# or: npm run report -- output/verifier_results.json

# 2. In OpenCode TUI:
/mongoose:report
# also works as /mongoose-report (hyphen) — file is mongoose-report.md (colon invalid on Windows), hook handles both
```

**Behavior:** hook `command.execute.before:123` in `mongoose.ts` checks `input.command` ∈ `{mongoose:report, mongoose-report, mongoose_report}` (strips leading `/`), looks up `output/verifier_results.json` candidates (`join(worktree,"output/verifier_results.json")`, `join(worktree,"verifier_results.json")`, `join(cwd,"output/verifier_results.json")`), `JSON.parse` + `formatVerifierReport(data)` (`mongoose.ts:34`, mirrors `print-report.ts:37`).

- **If found:** literal report string via `output.parts = [{type:"text", text}]` — no wrapper:
  ```
  ============================================================
    MONGOOSE — VULNERABILITY VERIFICATION REPORT
  ============================================================
    Run: 2026-08-31T00:00:00.000Z
    Total proven exploits: 3
  …
    [PROVEN] Missing signer check — process_instruction(authority)
      Exploit transaction: 5FakeSig…
  ```
- **If missing:** `No verifier results found. Checked: … To generate: solana-test-validator …` (`mongoose.ts:137`) — tells user to run the 3 commands above, with `README.md` CI/Reproduction links.

**Verified:** `opencode debug config` in a fresh process shows `plugin: ["file:///…/mongoose.ts"]` + `command.mongoose-report` (`template: "$ARGUMENTS"` after `deaec31`), `npx tsc --noEmit --skipLibCheck` 0 errors, `npx tsx` headless hook test renders full report with `3× PROVEN, 1× UNCONFIRMED` (dummy `output/verifier_results.json` gitignored via `.gitignore:5`).

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `mongoose_detect` not in tool list / `/mongoose:report` shows template text only | Session started before ` .opencode/plugin/mongoose.ts` existed — plugins load once at startup (skill `customize-opencode`: `quit and restart opencode`) | Quit `opencode` (session `7872` etc.) and start a fresh session in repo |
| `Extractor: no #[derive(Accounts)] structs` | Pointed tool at a `pinocchio` fixture (`fixtures/programs/missing_signer`) instead of an Anchor `src/` | Use a `data/sealevel-attacks/…/insecure/src` path |
| `No verifier results found` | Never ran `scripts/build-and-deploy.sh` + `verify:ci`, or ran in different `worktree` | Run the 3 commands above, or download CI artifact `mongoose-verifier-results` from GitHub Actions |

### Scope & non-goals (time-boxed)

This branch (`feature/opencode-plugin`) wraps **only** Extractor + Detector `--skip-verify`. Verifier/validator (`src/verifier.ts`, `src/verifier-ci.ts`, `solana-test-validator`) is explicitly out of scope and must not be touched — it is proven on `main` (`Cargo.lock v3`, `pinocchio 0.7.1`). See `MEMO_FOR_AGENT.md:1` for full program specs and branch history (`45cca0f` + `deaec31`).

## Ground rules

- Exploits only against a local validator. No devnet/mainnet.
- No secrets in the repo. Fixture keypairs under `fixtures/keys/` are test-only.
- Proven requires a real transaction signature. Otherwise UNCONFIRMED.
- Set `OTTER_SIGNALS_ONLY=1` to skip the Detector LLM (CI default).

## Versions

Node 20.x · TypeScript 5.4 · `@solana/web3.js` 1.91.x · Anchor 0.29.0 · Solana CLI 1.18.x
