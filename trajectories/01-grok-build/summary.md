# Grok Build — Trajectory Summary

## What This Agent Built
- Analyzed `otter_spec_and_pitch.md` and produced the hackathon bet: 3-stage pipeline (Extractor → Detector → Verifier) with failure-mode table and 5-class scope (1–3 proven, 4–5 suspected-only).
- Locked Detector contract as `detect(summary: ProgramSummary) → Promise<Finding[]>` with conservative prompt (“only flag what’s absent”), JSON schema via Zod, and clarified build-time vs runtime agents (Grok Build/Claude Code/OpenCode are not the Detector).
- Scaffolded TypeScript CLI: `src/types.ts`, `src/extractor.ts`, `src/detector.ts`, `src/verifier.ts`, `src/baseline.ts`, `src/pipeline.ts`, `src/dataset.ts`, `src/llm.ts`, `src/cache.ts`, `src/report.ts`, `src/selftest.ts`, `src/index.ts`, `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `CHANGELOG.md`, `data/fp-memory.json`.
- Implemented Extractor that walks `#[derive(Accounts)]`, `Signer<'info>`, `has_one`, and handler-body checks (`is_signer`, owner compare, discriminants, PDA seeds/extra_args), with caching by source hash; verified via `scripts/run-selftest.mjs`.
- Wired dataset discovery for `coral-xyz/sealevel-attacks` (after correcting the `neodyme-labs` 404), validated 11 families and ~35 programs, and added `--in-scope` / `--families` filtering for 6 v1 families → 18 programs.
- Migrated Detector transport from xAI (`api.x.ai`) to Groq Cloud (`api.groq.com/openai/v1`, `GROQ_API_KEY`, `DETECTOR_MODEL` defaults), kept `response_format: json_object` and `temperature: 0`.
- Added rate-limit handling (3000ms → 8000ms inter-call delay, `Calling Groq for [program]...`, 429 wait 10s retry once) and JSON-parse failure handling, plus `--families` eval wiring for `otter_iter1.json` / `baseline_results.json` / `comparison_table.md` and the `=== OTTER ITERATION 1 SUMMARY ===` console format.

## Key Turns (with references)
| Turn # | Topic | Agent Action | Human Feedback |
|--------|-------|--------------|----------------|
| 1–2 | Spec analysis + detector lock | Read `otter_spec_and_pitch.md`, explained pipeline, rejected “plug OpenCode as Detector” and defined `detect(summary)` interface | Human: “can i plug in things like opencode, grok build, claude code etc as the detector?” → Agent clarified; human: “okay lets proceed with the dev process quickly” |
| 3 | Dataset wiring | Cloned `neodyme-labs` (404), then `coral-xyz/sealevel-attacks`, fetched insecure/secure samples per class via `WebFetch` | No pushback; agent discovered 11 families (`0-signer-authorization`, `1-account-data-matching`, `2-owner-checks`, `3-type-cosplay`, `7-bump-seed`, `8-pda-sharing`, etc.) |
| 4 | Scaffolding + selftest | Created ~18 files via `Edit` tools, ran `node --experimental-strip-types` selftest with brace/owner-check fixes | Human: “retry all the failed commands again the network should be better” |
| 5 | npm install retries | `npm install` hit `ECONNRESET` and `npm.ps1` execution-policy block; retried with `npm.cmd --fetch-retries=8 --fetch-retry-mintimeout=20000 --maxsockets=2` and `npm.cmd install tsx@4.7.2 --no-save` | Succeeded: 86 packages, lockfile written, `npm run selftest` passed |
| 6 | Env & in-scope eval | Added `.env` fail-fast (`requireXaiApiKey` / `requireGroqApiKey`), `.gitignore` for `.env`, `--in-scope` selecting 6 families (6 vuln + 12 fixed, not 15/15) | Human repeatedly asked to run first end-to-end eval (`otter --families 0-signer-authorization,... --skip-verify`) but no real API key was present → 0 programs written |
| 7 | Groq migration | Changed `src/llm.ts` baseURL, env var, `DETECTOR_MODEL` to `llama-3.1-70b-versatile`, kept prompt/schema | Human: “Switch the Detector from xAI to Groq Cloud… 3000ms delay … 429 wait 10s retry” → Agent executed test `otter --families 0-signer...,2-owner...,3-type...` (9 programs) to verify `Finding[]` shape |

## Tools Used
- `ListDir`, `Search`, `Read`
- `WebSearch`, `WebFetch` (xAI docs, sealevel-attacks raw `lib.rs`, GitHub API)
- `Execute` (`git clone`, `Get-ChildItem`, `npm.cmd install`, `node scripts/run-selftest.mjs`, `node --experimental-strip-types`, `npx tsx`)
- `Edit` (dozens of file creates/edits for `src/*`, `package.json`, `.env.example`)

## Output Artifacts
- `src/extractor.ts`, `src/detector.ts`, `src/verifier.ts`, `src/baseline.ts`, `src/pipeline.ts`, `src/dataset.ts`, `src/llm.ts`, `src/types.ts`, `src/util.ts`, `src/report.ts`, `src/selftest.ts`, `src/cache.ts`, `src/index.ts`
- `package.json` (`otter:inscope`, `baseline:inscope`, `otter --families`), `tsconfig.json`, `.gitignore`, `.env.example`, `.env` (placeholder), `CHANGELOG.md`, `data/fp-memory.json`
- `data/sealevel-attacks/` (cloned corpus), `scripts/run-selftest.mjs`

## What Was Rejected or Iterated
- Rejected plugging coding agents (`claude -p`, OpenCode) as the Detector — would be slow, unschematized, and blow up FP on fixed programs; locked to one Grok JSON call instead.
- Iterated on dataset URL: `neodyme-labs/sealevel-attacks` 404 → `coral-xyz/sealevel-attacks`.
- Iterated on Extractor fallback: full `web-tree-sitter` was spec’d but shipped regex + brace matching (spec’s own fallback) as sufficient for this corpus.
- Iterated on `--limit 6` (file order) → `--in-scope` / `--families` (correct 18-program selection).
- Retried npm install multiple times (registry `ECONNRESET`, `npm.ps1` blocked) with retry flags and `npm.cmd`; fixed selftest brace handling for owner checks.
- Placeholder API key caused early exit before any `Finding[]`; kept prompt/schema unchanged while only transport changed (xAI → Groq) per human direction.

---
