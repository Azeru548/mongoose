# Agent Trajectories — Mongoose

## Project
**Mongoose** — An agentic security pipeline that proves Solana/Anchor vulnerabilities with real on-chain exploit transactions, not just static flags.

## Agents Used
| # | Agent | Primary Role | Raw Export File |
|---|-------|--------------|-----------------|
| 1 | Grok Build | Initial scaffolding, spec analysis, Extractor/Detector/Verifier pipeline architecture, dataset wiring, Groq transport migration | `01-grok-build/grokbuildtrajectory` (also at `trajectories/grokbuildtrajectory`) |
| 2 | Claude | [FILL: Unable to determine from raw export — no export file present; expected role per MEMO: verifier logic and pinocchio fixture authoring — needs human confirmation] | `02-claude/` — **missing export** |
| 3 | Kimi | Hero CSS responsiveness fix (`mongoose_fixed.html`), memo synthesis (`MEMO_FOR_AGENT.md` current-state), plugin verification guidance, CI judge-readiness notes | `03-kimi/kimi.docx` (also at `trajectories/kimi.docx`) |
| 4 | Muse Spark | Detector Accuracy CI workflow (`feature/ci-detector-accuracy`), signals-only determinism (`OTTER_SIGNALS_ONLY=1`), artifact/summary generation | `04-muse-spark/opencodetrajectory.md` (also at `trajectories/opencodetrajectory.md`) |
| 5 | Mimo | [FILL: Unable to determine from raw export — no export file present; needs human to fill primary role] | `05-mimo/` — **missing export** |

## Human Checkpoints & Steering
> The hackathon requires evidence that the human steered the agents, not just accepted output.

| # | Checkpoint | Agent | What Agent Suggested | Human Decision | Result |
|---|------------|-------|----------------------|----------------|--------|
| 1 | Detector vs coding agents | Grok Build | Proposed that OpenCode / Grok Build / Claude Code *could* be the Detector by spawning `claude -p` and parsing stdout | Human asked to lock detector concretely; agent clarified build-time vs runtime distinction and locked `detect(summary) → Finding[]` with one Grok JSON call (`grokbuildtrajectory` lines 112–196) | Detector is a typed classifier, not a wandering coding agent; keeps 30-program eval deterministic |
| 2 | Hero mobile garble & second line | Kimi | First fix removed `.deco-lines` and changed hero ticker from `position: absolute` to `position: relative` with margin (`kimi.docx`) | Human: “the hero section of the page isnt mobile responsive and looks garbled please fix that and remove the second straight line in the hero section that below the one on guesses” | Shipped `mongoose_fixed.html` with cleaner mobile layout |
| 3 | Pipeline scope for plugin branch | Kimi (via MEMO_FOR_AGENT.md) | MEMO stated constraints: “Do NOT touch src/verifier.ts, src/verifier-ci.ts, or validator logic on this branch. Plugin scope is Extractor + Detector only (--skip-verify).” | Human kept `feature/opencode-plugin` isolated, verified plugin end-to-end then left branch unmerged (`kimi.docx` “Do not merge to main — keep this branch isolated”) | Verifier on `main` stayed CI-green |
| 4 | Detector Accuracy workflow scope | Muse Spark | Prompt enforced “Do NOT work on feature/opencode-plugin”, “Do NOT touch src/verifier.ts / .github/workflows/verify.yml / .opencode/ / src/types.ts” (`opencodetrajectory.md` PROMPT) | Human created `feature/ci-detector-accuracy` from `main` as instructed; agent respected file blocklist | CI-only change landed without touching verifier |
| 5 | OTTER_SIGNALS_ONLY without API key | Muse Spark | Detector skips Groq when `OTTER_SIGNALS_ONLY=1` (`src/detector.ts:145`) but `src/index.ts:31` still called `requireGroqApiKey()` unconditionally | [FILL: Human has not explicitly approved the `src/index.ts:31` conditional guard — agent added `if (OTTER_SIGNALS_ONLY !== "1") requireGroqApiKey()` to allow CI without secrets; needs human confirmation this steering was intended] | CI workflow runs without `GROQ_API_KEY` |
| 6 | Network failure handling | Grok Build | `npm install` failed with `ECONNRESET`, registry throttling | Human: “retry all the failed commands again the network should be better” (`grokbuildtrajectory` line 358) | Agent retried with `--fetch-retries=8 --fetch-retry-mintimeout=20000 --maxsockets=2` and succeeded |

## Key Engineering Decisions
| Decision | Agent(s) | Evidence in Trajectory | Why It Mattered |
|----------|----------|------------------------|-----------------|
| Deterministic Extractor before LLM | Grok Build | `grokbuildtrajectory` lines 30–47, 230–308 — scaffolded `src/extractor.ts` to walk `#[derive(Accounts)]`, `Signer<'info>`, `has_one`, handler-body checks (`is_signer`, owner, discriminants, PDA); fallback regex noted as spec-approved | Prevents Detector hallucinations on fixed programs; keeps FP low so Verifier only sees real candidates |
| 5-class taxonomy + conservative prompt (“only flag what’s absent”) | Grok Build | `grokbuildtrajectory` lines 119–147, 537–555 — `DETECTOR_SYSTEM_PROMPT` with Zod `FindingSchema`, `confidence` enum, “if Extractor already listed constraint do not flag” | Enables scoring: TP on insecure, zero FP on secure; taxonomy maps directly to sealevel-attacks families |
| Switch from xAI to Groq Cloud (`api.groq.com`, `GROQ_API_KEY`, `llama-3.1-70b-versatile` → later `openai/gpt-oss-20b`, `allam-2-7b`) with throttling | Grok Build | `grokbuildtrajectory` lines 963–1024 — user: “Switch the Detector from xAI to Groq Cloud… 3000ms delay … 429 wait 10s retry once” | Solved rate-limit / availability; kept `response_format: json_object` and `temperature: 0` unchanged |
| Pin pinocchio 0.7.1 fixtures (not upstream Anchor 0.20) | Kimi (via memo) + inferred Claude | `kimi.docx` MEMO: “Hand-authored minimal pinocchio 0.7.1 programs … to avoid cargo 1.75 + edition2024 + Cargo.lock v4 chain” | Bypassed `cargo 1.75 + edition2024` failure chain that blocked CI on sealevel-attacks programs; 4 fixtures deploy in <20 min |
| `OTTER_SIGNALS_ONLY=1` in CI for reproducible signals-only run | Kimi (memo) + Muse Spark | `kimi.docx` “OTTER_SIGNALS_ONLY=1 mode skips LLM for deterministic CI runs”; `opencodetrajectory.md` relies on `src/detector.ts:145` skip + `src/index.ts:31` guard; `detector-accuracy.yml:38` sets env | Eliminates LLM dependency for reproducible CI; lets Detector Accuracy workflow run on 18 in-scope cases without secrets or validator |
| In-scope family filter (`--in-scope` / `CLASS_BY_FAMILY`) covering 6 families → 18 programs (6 vulnerable + 12 fixed) for primary TP/FP | Grok Build | `grokbuildtrajectory` lines 584–594, `src/dataset.ts` mapping; `opencodetrajectory.md` reads `src/dataset.ts` and `src/pipeline.ts:114` `FAMILIES_V1` | Explains landing-page “6/6, 0/12” denominator; other 5 families excluded from primary metrics but still runnable |
| CI Verifier vs Detector Accuracy split (validator vs source-only) | Muse Spark | `opencodetrajectory.md` PROMPT problem statement — existing `verify.yml` only covers 4 pinocchio fixtures with live validator; new `detector-accuracy.yml:1` is source-only | Gives judge separate proof: 4 exploits proven on-chain + 30 programs scored statically; closes “faked numbers” gap |
| Conditional Groq key skip in `src/index.ts` | Muse Spark | `opencodetrajectory.md` tool calls to `src/index.ts` then `edit` to guard `requireGroqApiKey()` when `OTTER_SIGNALS_ONLY=1` | [FILL: Needs human confirmation — agent inferred this was required because CI has no `.env`; task said “No source code changes unless absolutely necessary”] |

## Retries & Corrections
> Show where the first attempt failed and you iterated.

| # | Problem | First Attempt | Correction | Final Outcome |
|---|---------|---------------|------------|---------------|
| 1 | npm registry flakiness (`ECONNRESET`, blocked `npm.ps1`) | `npm install` failed; `npm.ps1 cannot be loaded because running scripts is disabled` (`grokbuildtrajectory` lines 259–286) | Retried via `npm.cmd` with `--fetch-retries=8 --fetch-retry-mintimeout=20000 --maxsockets=2`, used `npm.cmd install tsx@4.7.2 --no-save`, ran selftest via `node scripts/run-selftest.mjs` | 86 packages installed, `npm run selftest` passed, CLI help worked |
| 2 | Wrong dataset URL (`neodyme-labs/sealevel-attacks` 404) | `git clone --depth 1 https://github.com/neodyme-labs/sealevel-attacks.git` (`grokbuildtrajectory` line 210) | Cloned `coral-xyz/sealevel-attacks` instead (`grokbuildtrajectory` line 221) and documented correction in README | Pipeline now discovers ~35 programs, 18 in-scope |
| 3 | Groq rate limiting (429) on full 6-family run | Initial detector run hit `429 Rate limit: Limit 8000 TPM` after ~5 cases (`grokbuildtrajectory` 800+ lines) | Added `GROQ throttle: waiting Xs`, 3s→8s inter-call delay (`src/llm.ts`, `src/detector.ts:13`), 10s retry on 429; later moved CI to `OTTER_SIGNALS_ONLY=1` to skip LLM entirely | Signals-only run completes in ~130s with `6/6 TP, 0/12 FP` and no 429 |
| 4 | Baseline/Dectector never executed (placeholder key) | `XAI_API_KEY=your-xai-api-key-here` in `.env` caused `Error: XAI_API_KEY is missing or still a placeholder` before any API call (`grokbuildtrajectory` lines 744–783, 913–944) | Added explicit `requireXaiApiKey()` / later `requireGroqApiKey()` fail-fast with instructions, added `.env` to `.gitignore`, waited for real key | Eval unblocked once `GROQ_API_KEY=gsk_...` set |
| 5 | In-scope selection used file order (`--limit 6` took one family + half of next) | Initial plan suggested `--limit 6` for “6 families” (`grokbuildtrajectory` lines 763–764) | Introduced `--in-scope` / `--families` filter selecting `FAMILIES_V1` six families (`src/dataset.ts`, `src/util.ts`, `src/index.ts`) | `npm run otter:inscope` now correctly runs 18 programs (6 vuln + 12 fixed) |
| 6 | Detector Accuracy output missing `6/6`/`0/12` grep markers | First `otter:inscope` run only logged `[otter] ... 1 finding(s)` per case, no summary line (`opencodetrajectory.md` reported missing grep hits) | Agent added `Generate accuracy summary from otter_results.json` step that computes `expected_class`-matched TP/FP and appends `[PASS]/[FAIL]` table + `Summary: 6/6 true positives, 0/12 false positives` to `output/detector_accuracy.txt` (`detector-accuracy.yml:53`) | `grep -q "6/6" && grep -q "0/12"` now passes; artifact matches landing-page claim |
| 7 | OTTER_SIGNALS_ONLY still required GROQ_API_KEY | Even with `OTTER_SIGNALS_ONLY=1`, `src/index.ts:31` called `requireGroqApiKey()` before `cmdOtter`, so CI would fail without `.env` (`opencodetrajectory.md` investigation) | Patched `src/index.ts:31` to `if (OTTER_SIGNALS_ONLY !== "1") requireGroqApiKey()` and added dummy `GROQ_API_KEY=gsk_dummy_for_ci_signals_only` in workflow (`detector-accuracy.yml:41`) | CI runs without secrets; local signals-only run verified (`1 finding(s) (13ms)`, `OTTER_SIGNALS_ONLY=1 — skipping Detector LLM`) |

## Missing Exports
- `02-claude/` — No raw export file found in `trajectories/`. If Claude contributed verifier/fixtures, add `02-claude/<export>.md` and update table.
- `05-mimo/` — No raw export file found. Add `05-mimo/<export>.md` if available.

## How to Read These Trajectories
1. Start with this `README.md` for the map.
2. Read each agent's `summary.md` for the narrative.
3. Read the raw export for complete evidence (tool calls, code diffs, full reasoning).

---
