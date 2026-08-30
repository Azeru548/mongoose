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

## Ground rules

- Exploits only against a local validator. No devnet/mainnet.
- No secrets in the repo. Fixture keypairs under `fixtures/keys/` are test-only.
- Proven requires a real transaction signature. Otherwise UNCONFIRMED.
- Set `OTTER_SIGNALS_ONLY=1` to skip the Detector LLM (CI default).

## Versions

Node 20.x · TypeScript 5.4 · `@solana/web3.js` 1.91.x · Anchor 0.29.0 · Solana CLI 1.18.x
