# Otter improvement changelog

| Stage | What You Tried | Evidence | Decision |
|---|---|---|---|
| Baseline | Generic "find bugs" prompt, raw code (`allam-2-7b`) | TP: **5/6**, FP: **8/12** | Floor established. High false-positive rate on fixed variants; misses type-cosplay. |
| Iteration 1 | Added 5-class taxonomy to Detector prompt | TP: ~4–5/6, FP: high on secure (prior Groq runs flagged C2/C3 on signer-secure, C4 on recommended) | Improved Solana-specific detection but model still hallucinated missing checks on fixed programs. |
| Iteration 2 | Structured Extractor JSON + field-mapped Detector prompt | TP improved on signer/owner when rules were followed; FP still non-zero under weak LLM | Prompt alone is not enough for `gpt-oss-20b`. |
| Iteration 3 | Deterministic validation layer (`signals.ts` + `finalizeFindings`) | TP: **6/6**, FP: **0/12**, localization: **100%** (`otter_iter2.json`) | Key fix: LLM suggests, code validates and backfills Classes 1–5 candidates. Eliminated false positives and backfilled misses. |
| Final | Full pipeline with validation (`--skip-verify`) | TP: **6/6**, FP: **0/12**, localization: **100%**; Baseline TP 5/6 FP 8/12 | Main contribution so far: tiered confidence (Suspected until Verifier) with deterministic validation preventing hallucinations. |
| Verifier CI | GitHub Actions builds Anchor 0.29 fixtures, deploys to `solana-test-validator`, runs exploit txs | `.github/workflows/verify.yml` + `fixtures/` + real `PROVEN` signatures in CI artifacts | Chromebook/Windows writes TS; Linux CI produces proofs. `OTTER_SIGNALS_ONLY=1` avoids Groq in CI. |

## Eval artifacts

- `otter_iter2.json` — Otter on 18 in-scope programs
- `baseline_results.json` — generic baseline on the same 18
- `comparison_table.md` — per-program table + aggregates

## Notes

- Dataset: `coral-xyz/sealevel-attacks` (6 families × insecure/secure/recommended).
- Detector transport: Groq `openai/gpt-oss-20b`; Baseline: Groq `allam-2-7b` (separate quota after Detector TPD exhaustion).
- Verifier not exercised in this eval (`--skip-verify`); all Otter findings are Suspected/UNCONFIRMED.
