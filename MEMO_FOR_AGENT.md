# Mongoose — Detailed Agent Memo

## 0. One-line
**Mongoose (formerly Otter) proves Solana/Anchor vulnerabilities with real transactions, not just flags them.** Every scanner says “looks broken.” Mongoose shows the transaction that broke it. Target user: solo/small Anchor teams without a $15k audit budget.

---

## 1. Repository & Branch State (as of 2026-08-31)

- **Root:** `C:\Users\PC\otter` (git repo `github.com/Azeru548/ottersec` — push remote)
- **Main:** `main @ cec2e00` (“fixed responsiveness”) — **stable, CI green.** Uses `pinocchio 0.7.1` fixtures, `Cargo.lock v3` (37 lines, no `edition2024`), `solana-test-validator` flow proven.
- **Feature branch (current):** `feature/opencode-plugin` off `main`
  - `45cca0f feat(opencode): mongoose plugin — detector only (skip-verify)` — scaffold + tool + command hook + `@opencode-ai/plugin@1.18.25` + restore `src/types.ts` (was overwritten with `verifier-ci.ts` on `main`, broke `tsc` but not `tsx` runtime because all `import type` erased)
  - `deaec31 fix(opencode): mongoose:report renders literal report, not meta` — trimmed ` .opencode/command/mongoose-report.md` template to `$ARGUMENTS` only; hook already returned `formatVerifierReport()` directly.
  - `main` **must not be touched** for verifier logic — this branch is isolated. Do **not** merge without manual review.
  - `src/verifier.ts:1` and `src/verifier-ci.ts:1` **must not be edited** on this branch (time-boxed scope, proven on `main`).
  - Current `git status` clean; `output/verifier_results.json` is gitignored via `.gitignore:5` (`output/`), dummy present locally for testing.

**Toolchain (pinned):** Node 20.x, TypeScript 5.4, `@solana/web3.js 1.91.8`, `rpc-websockets 7.5.1` (pinned to fix missing `dist/lib/client`), Solana CLI 1.18.26, Anchor 0.29.0, `opencode-ai 1.18.25`, `@opencode-ai/plugin 1.18.25`, `zod 3.23.8` (plugin uses `4.1.8` via SDK, compatible), `tsx 4.7.2`.

---

## 2. Product & Dataset

**Dataset:** `data/sealevel-attacks` (cloned via `npm run setup:dataset` → `github.com/coral-xyz/sealevel-attacks` — the public mirror of `neodyme-labs/sealevel-attacks` which is private). Spec originally named `neodyme-labs/sealevel-attacks`.

**In-scope families (primary TP/FP):** `0-signer-authorization`, `2-owner-checks`, `3-type-cosplay`, `1-account-data-matching`, `7-bump-seed-canonicalization`, `8-pda-sharing`. Other families still run but excluded from primary metrics. Total 30 test cases (5 classes × 3 pairs × 2 variants = 15 vulnerable + 15 fixed), see `src/dataset.ts`, `src/pipeline.ts:114`.

**Ground rules:** Local validator only (`http://127.0.0.1:8899`), no devnet/mainnet. Proven = real signature, otherwise `UNCONFIRMED`. `OTTER_SIGNALS_ONLY=1` skips Detector LLM (CI default, deterministic signals only).

---

## 3. Vulnerability Taxonomy (v1)

| # | Class | What it is | Verifier coverage |
|---|-------|------------|-------------------|
| 1 | Missing signer check | `authority`/`admin` AccountInfo without `is_signer` | **Full** — send tx with `isSigner:false` (`verifier.ts:201`) |
| 2 | Missing owner check | `owner_constraint==null` on `AccountInfo` | **Full** — create System-owned account, pass it (`verifier.ts:242`) |
| 3 | Type cosplay | `has_discriminator==false` on `AccountInfo`, no `discriminant` check | **Full** — System-owned 8-byte account without Anchor discriminator (`verifier.ts:301`) |
| 4 | Missing `has_one` | Two accounts logically linked but `has_one==[]` | **Suspected only** — needs multi-account setup (`verifier.ts:129`) |
| 5 | Insecure PDA seeds | User-controlled/static seeds, `bump` in `extra_args` + `create_program_address` without `find_program_address` | **Suspected only** (`verifier.ts:129`) |

---

## 4. Pipeline — Three Stages

### [1] Extractor (`src/extractor.ts:16`, deterministic, no LLM)
- Input: path to Anchor program `src/` (e.g. `data/sealevel-attacks/programs/0-signer-authorization/insecure/src`)
- Walks Rust source (regex/tree-walk, strips comments via `stripComments`, `extractBlock` for `{}`), finds `#[derive(Accounts)]` structs (`parseAccountsStructs:87`), parses `#[account(...)]` attrs (`signer`, `mut`, `has_one=`, `owner=`, `seeds`, `address`), and `pub fn handler(ctx: Context<Struct> …) {}` bodies (`parseHandlers:179`). Collects `handler_checks` (`is_signer`, `owner`, `discriminant`, `try_from_slice`, `create_program_address`, etc. `collectHandlerChecks:222`).
- Output: `ProgramSummary` (`src/types.ts:32`) — `program_id` (from `declare_id!`), `program_name`, `instructions[]` (with `accounts: AccountSummary[]`, `constraint_summary`, `handler_source` sliced 2000 chars), `account_types[]`, `source_hash` (sha256). Cached via `src/cache.ts`.
- Fails hard if no `#[derive(Accounts)]` or no handlers — does not guess (`extractor.ts:37`).

### [2] Detector (`src/detector.ts:99`, one Grok call + deterministic signals)
- **System prompt** `DETECTOR_SYSTEM_PROMPT:28` encodes 5-class taxonomy with exact `Extractor` fields to check. Very conservative (prefers no finding over weak).
- **Signals:** `src/signals.ts:46` `computeRiskSignals` scores each `instruction.account` for `class1..5` using `isAccountInfo` (`AccountInfo`/`UncheckedAccount`), `isAnchorAccount` (`Account<>`/`Box<Account>`), skip lists (`token_program`, `system_program`, `rent`, etc.), `SIGNER_ROLE=authority|admin|owner|payer`, etc. `formatRiskSignals:159` prints `PRECOMPUTED RISK SIGNALS — You may ONLY emit … allow classes [1,2]`.
- **LLM:** `completeJson` via `src/llm.ts` (`GROQ_API_KEY`, `https://api.groq.com/openai/v1`, default `openai/gpt-oss-20b` via `detectorModel()`). Includes `data/fp-memory.json` false-positive memory (`loadFalsePositiveMemory:91`). `throttleDetector:12` logs `Calling Groq … delay: 8s`.
- **Gating:** `finalizeFindings:204` / `finalizeFindingsDetailed:250` drops any LLM finding not in `allowedClasses(signal)` or where `class1` already set but LLM also emits `2/3` on same `authority` account.
- **CI mode:** If `process.env.OTTER_SIGNALS_ONLY==="1"` (`detector.ts:145`), skips LLM entirely and returns `finalizeFindingsDetailed(summary, [], signals)` — deterministic only. This is what the OpenCode plugin and `verify.yml:81` use.

### [3] Verifier (`src/verifier.ts:44`, dynamic, no LLM)
- `probeValidator:75` tries `Connection.getVersion()` 10×. `resolveDeploy:89` maps `finding` → `DeployEntry` via `output/deploy-map.json` (`byCaseId`, `caseIds`). `FIXTURE_BY_CLASS:28` maps `1→missing_signer`, etc.
- `verifyOne:122`:
  - `1` → `proveMissingSigner:201` — `TransactionInstruction { isSigner:false }` with `anchorDisc("log_message")` (sha256 `"global:log_message"` first 8 bytes, `anchorDisc:186`), `sendAndConfirmTransaction` with only `payer` (not `authority`), expects success.
  - `2` → `proveMissingOwner:242` — `SystemProgram.createAccount` (rent 8 bytes, owner `SystemProgram.programId`), then `anchorDisc("touch")` with `data`+`authority`, expects success.
  - `3` → `proveTypeCosplay:301` — same but 8-byte System account, `anchorDisc("update_user")`, expects success on `UncheckedAccount`.
  - `4/5` → immediate `UNCONFIRMED` with notes.
- Output: `VerifiedFinding` (`verdict: PROVEN|UNCONFIRMED`, `exploit_transaction`, `pre_state`/`post_state`, `notes`). Pipeline writes `output/verifier_results.json` + `verifier_results.json` root.

---

## 5. Fixtures — Why They Exist and How They Work

Upstream `sealevel-attacks` is Anchor 0.20, but our repo pins Anchor 0.29. To keep CI <20 min and avoid Anchor version drift, `fixtures/programs/` are **hand-authored minimal `pinocchio 0.7.1`** programs that intentionally exhibit Classes 1–3 (plus a secure control):

- `fixtures/Cargo.toml:2` workspace with `resolver="2"`, `profile.release` fat LTO.
- `fixtures/Anchor.toml:2` `anchor_version="0.29.0"` but **no Anchor deps** — `Cargo.lock:3` `version=3` (66 lines) only `pinocchio 0.7.1` + `pinocchio-pubkey 0.2.2` + `five8_*` (`five8_const 0.1.4`, `five8_core 0.1.2`). This solved the 8-hour `cargo 1.75 / edition2024 / v4 lockfile / pinocchio 0.8.4 requires rustc 1.79` failure chain. `pinocchio::pubkey::declare_id!` vs `pinocchio::declare_id!`, `msg!("GM")` literal-only (no `msg!("GM {}", key)`), `entrypoint!` already includes `default_panic_handler!` (so extra causes `custom_panic redefined`).
- Four crates:
  - `missing_signer` (`fixtures/programs/missing_signer/src/lib.rs:6` `pinocchio_pubkey::declare_id!("9AkR…")`, `entrypoint!(process_instruction)`, `msg!("GM")`, **no** `is_signer` check — vulnerable)
  - `missing_signer_secure` (`…/missing_signer_secure/src/lib.rs:7` same but `if !accounts[0].is_signer() { msg!("authority must sign"); Err(MissingRequiredSignature) }` — secure control)
  - `missing_owner` (`…/missing_owner/src/lib.rs:6` `msg!("touched")` + `borrow_lamports_unchecked`, **no** `owner` check — vulnerable)
  - `type_cosplay` (`…/type_cosplay/src/lib.rs:6` `borrow_data_unchecked`, **no** discriminator — vulnerable)
- `scripts/build-and-deploy.sh:1` — waits for validator health (`curl /health`), `solana-keygen new` per crate, `sed -i` patches `declare_id!("PUBKEY")` in `lib.rs:62` and `Anchor.toml:66`, `cargo-build-sbf --manifest-path … -- --locked` (`:77`), `solana program deploy` (`:86`), writes `output/deployed_programs.json:88` plus `output/deploy-map.json` (used by `verifier.ts:89` and `verifier-ci.ts:57` overlay).
- `src/verifier-ci.ts:1` — **not** the generic pipeline; it **seeds** a `Finding` per `deployed.expectedClass` (`seed:122` `process_instruction.authority`) because `Extractor` is Anchor-oriented and would `throw` on `pinocchio` fixtures (`extractor.ts:37`). It then `verifyFindings` via `defaultVerifierContext` with `deployMapPath` overlay. This is what `verify.yml:82` runs with `OTTER_SIGNALS_ONLY=1`.

---

## 6. CI Verifier (`verify.yml:1`)

- `ubuntu-latest`, `20min` timeout, `concurrency: mongoose-verify-${github.ref}`.
- `Setup Node 20`, `npm ci`, `actions/cache@v4` for `~/.cargo/...` + `fixtures/target/`, `Install Solana CLI 1.18.26` via `release.anza.xyz/v1.18.26/install`, `solana --version` + `node -v`, `solana-test-validator --reset --quiet` (90s health loop), `chmod +x scripts/build-and-deploy.sh && ./scripts/build-and-deploy.sh`, `npm run verify:ci` with `SOLANA_RPC_URL=http://127.0.0.1:8899`, `OTTER_DEPLOYED_PROGRAMS=output/deployed_programs.json`, `OTTER_VERIFIER_RESULTS=output/verifier_results.json`, `OTTER_SIGNALS_ONLY=1`, `Print verifier_results.json`, `upload-artifact@v4` (`deployed_programs.json`, `verifier_results.json`, `deploy-map.json`, `/tmp/validator.log`), `kill validator`.

**Expected:** 4 cases, `provenTotal >=1`, each `ok` matches `expectProven` (3× `true` → at least one `PROVEN`, 1× `false` → no `PROVEN`).

---

## 7. OpenCode Plugin — Feature Branch Scope (Time-boxed 2h, do NOT touch Verifier)

**Goal:** Wrap **Extractor + Detector only** (`--skip-verify`, no validator) as an OpenCode CLI plugin. Time-boxed 2h; if not loading in 60m, stop and report blocker.

**Constraints:** Branch `feature/opencode-plugin` only. **Do not** edit `src/verifier.ts`, `src/verifier-ci.ts`, deployment/validator. Plugin only calls `extractProgram:16` and `detect:104` in `OTTER_SIGNALS_ONLY=1` mode (set programmatically, not via user env).

**Implementation (committed):**
- **Scaffold:** `.opencode/plugin/` auto-discovered (skill `customize-opencode` — no `opencode.json` entry needed). `npm install --save-dev @opencode-ai/plugin@1.18.25` (`package.json:26`). Plugin entry `.opencode/plugin/mongoose.ts:1` `export default (async ({directory, worktree}) => ({ tool: {…}, "command.execute.before": … }) satisfies Plugin` (`@opencode-ai/plugin/dist/index.d.ts: Plugin = (input: PluginInput) => Promise<Hooks>`; `tool` via `tool({description, args, execute})` from `dist/tool.d.ts: tool.schema = z`).
- **Tool:** `mongoose_detect` — Zod `programPath: string` (required). Impl: `resolve(base, raw)` (`ctx.directory||directory||worktree`), `existsSync` check, `process.env.OTTER_SIGNALS_ONLY="1"` (save/restore `prev`), `await import("../../src/extractor.js")` + `await import("../../src/detector.js")` (dynamic, `.js` for `tsx`/`Bun` remap), `extractProgram(fullPath)` → `detect(summary, [], label)` → `formatFindings` (`CLASS_NAMES[1..5]`). Returns `Mongoose detect — <path> / Program: … / Found N finding(s): - [Class …] … Reasoning: …` or `Extractor failed … no #[derive(Accounts)]`.
- **Command:** `mongoose:report` — slash command file `.opencode/command/mongoose-report.md:1` (`description`, template `$ARGUMENTS` only — trimmed from meta-description in `deaec31` so hook output is not doubled). Hook `command.execute.before:123` handles `cmd ∈ {mongoose:report, mongoose-report, mongoose_report}` (strip leading `/`), looks up `output/verifier_results.json` candidates (`join(base,"output/verifier_results.json")` etc.), if missing returns `No verifier results found. Checked: … To generate: solana-test-validator … ./scripts/build-and-deploy.sh … OTTER_SIGNALS_ONLY=1 npm run verify:ci` (`mongoose.ts:137`), else `JSON.parse(readFileSync)` → `formatVerifierReport(data)` (`mongoose.ts:34`, mirrors `src/print-report.ts:37` `MONGOOSE — VULNERABILITY VERIFICATION REPORT` with `Program / Expected / Result / [PROVEN] Exploit transaction: …` or `[BLOCKED / UNCONFIRMED]`). Hook sets `output.parts = [{type:"text", text}]` — **literal report, no wrapper**.
- **Tests:** `npx tsx test-mongoose.mjs` (direct) and `npx tsx test-plugin.mjs` (import plugin, call `tool.execute`, call hook) — both passed: `data/sealevel-attacks/programs/0-signer-authorization/insecure/src` → `Found 1 finding(s): [Class 1 …] HIGH`; `output/verifier_results.json` dummy → full report with `3× PROVEN, 1× UNCONFIRMED`; missing file → correct message. `opencode debug config` in fresh process shows `plugin: ["file:///…/mongoose.ts"]` + `command.mongoose-report` (template `$ARGUMENTS`), proving auto-discovery (current TUI `7872` predates plugin, needs restart — `opencode` loads config once at startup, skill says `quit and restart opencode`).

**Known TUI quirk:** Slash command file cannot contain `:` on Windows, so file is `mongoose-report.md` (hyphen) → slash is `/mongoose-report`; hook also accepts `/mongoose:report` (colon) alias. Command `debug config` confirms hyphen form, hook normalizes both.

**What remains (per 2h box, STEP 1–5):**
- STEP 1 — restart `opencode` (quit `7872`, fresh session) and confirm no plugin toast/error.
- STEP 2 — live `use mongoose_detect to scan data/sealevel-attacks/programs/0-signer-authorization/insecure/src` via agent → expect tool call and same HIGH finding as `test-mongoose.mjs`.
- STEP 3 — `/mongoose-report` with no file → missing message; place real `output/verifier_results.json` (dummy already or CI artifact) → full report.
- STEP 4 — if both pass, commit (already `deaec31`), do **not** merge `main`, report “plugin confirmed working end-to-end” + demo commands.
- STEP 5 — if either fails in live TUI (scripts passed), report exact error and decide quick fix vs cut.

**Demo commands (for video after restart):**
- `use mongoose_detect to scan data/sealevel-attacks/programs/0-signer-authorization/insecure/src`
- `/mongoose-report` (then with `output/verifier_results.json` present)
- `mongoose_detect` tool also callable directly in this session (no restart needed for tool API).

---

## 8. Program Specs — Files to Read

- **Extractor:** `src/extractor.ts:16`, `src/types.ts:32` (`ProgramSummary`), `src/cache.ts`, `src/util.ts` (`walkRsFiles`, `extractBlock`, `stripComments`).
- **Signals/Detector:** `src/signals.ts:46` (`scoreAccount`, `CLASS1_DATA_SKIP`, `SIGNER_ROLE`), `src/detector.ts:28` (`DETECTOR_SYSTEM_PROMPT`), `src/llm.ts` (`completeJson`, `detectorModel()`), `data/fp-memory.json`.
- **Verifier:** `src/verifier.ts:44`, `src/verifier-ci.ts:102` (`runCase`, seeding), `output/deployed_programs.json`, `output/deploy-map.json`.
- **Print:** `src/print-report.ts:37` (`formatVerifierReport` mirror).
- **Scripts:** `scripts/build-and-deploy.sh:1`, `scripts/run-selftest.mjs`, `package.json:10` scripts (`otter:inscope`, `baseline:inscope`, `extract`, `report`).
- **Fixtures:** `fixtures/programs/{missing_signer,missing_signer_secure,missing_owner,type_cosplay}/src/lib.rs:1`, `fixtures/Cargo.toml:1`, `fixtures/Anchor.toml:1`, `fixtures/Cargo.lock:1`.
- **Plugin:** `.opencode/plugin/mongoose.ts:1`, `.opencode/command/mongoose-report.md:1`, `opencode debug config` to verify.

---

## 9. Current Progress & Next Move

- **Done:** Fixtures minimal `pinocchio 0.7.1` (solved `cargo 1.75` + `edition2024`), `Cargo.lock v3`, 4 programs deploy, `verify:ci` seeding works, `tsc --noEmit --skipLibCheck` 0 errors after restoring `src/types.ts` from `0a9b1cb`, plugin scaffold + `mongoose_detect` + `mongoose:report` committed and headless-tested, `debug config` confirms fresh load.
- **Pending:** Live TUI restart + agent tool call + slash command visual confirmation (well under remaining hour). If `command.execute.before` still shows template instead of report in same live session, it is expected until restart — `deaec31` already trimmed template to `$ARGUMENTS` so fresh session will show only report.
- **Do NOT:** touch `src/verifier.ts` / `src/verifier-ci.ts` / validator logic; wrap only Extractor+Detector signals-only; keep all work on `feature/opencode-plugin`.

