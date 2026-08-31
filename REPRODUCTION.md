# Reproduction Guide — Mongoose

## Environment

- **OS:** Ubuntu 22.04+ (CI tested), macOS (local dev), Windows with WSL
- **Node:** 20.x
- **Solana CLI:** 1.18.26 (only for verifier — detector does not need this)
- **Rust/cargo:** 1.75+ (only for verifier fixture builds)
- **Git:** Any recent version

## Setup

```bash
# 1. Clone
git clone https://github.com/Azeru548/mongoose.git
cd mongoose

# 2. Install dependencies
npm ci

# 3. Clone the dataset (for detector accuracy)
npm run setup:dataset
# Expected: data/sealevel-attacks/ appears with 18+ programs
```

## Baseline Solution

The baseline uses a generic "find bugs" prompt with raw code input and no Solana-specific context.

```bash
# Run baseline detector on in-scope families
npm run baseline:inscope
```

**Expected output:**
- 5/6 true positives (vulnerable programs flagged)
- 8/12 false positives (secure programs incorrectly flagged)
- Runtime: ~2–3 minutes (includes LLM calls with 8s delays)
- Cost: Groq API calls (minimal, ~$0.01)

## Advanced Solution

The advanced solution uses structured extraction + deterministic signals + live exploit verification.

### A. Detector Accuracy (Source-only, no validator needed)

```bash
# Run advanced detector on full dataset
OTTER_SIGNALS_ONLY=1 npm run otter:inscope
```

**Expected output:**
```
Summary: 6/6 true positives, 0/12 false positives
Otter TP: 6/6 | FP: 0/12
```
- Runtime: **Under 1 minute** (deterministic, no LLM)
- Cost: **$0** (no API calls)

### B. Live Exploit Verification (Requires validator)

```bash
# 1. Start local validator (in background)
solana-test-validator --reset --quiet &
VALIDATOR_PID=$!

# 2. Wait for health
until curl -s http://127.0.0.1:8899/health; do sleep 2; done

# 3. Build and deploy fixtures
chmod +x scripts/build-and-deploy.sh
./scripts/build-and-deploy.sh

# 4. Run verifier
OTTER_SIGNALS_ONLY=1 \
SOLANA_RPC_URL=http://127.0.0.1:8899 \
npm run verify:ci

# 5. Check results
cat output/verifier_results.json

# 6. Kill validator
kill $VALIDATOR_PID
```

**Expected output:**
```
TOTAL PROVEN: 3
CASES OK: 4/4
```
- 3 real exploit transaction signatures (Classes 1, 2, 3)
- 1 secure case correctly blocked (Class 1 secure variant)
- Runtime: **~10 minutes** (mostly fixture build + deploy)
- Cost: **$0** (local validator, no API calls)

## CI Reproduction

Both workflows run automatically on GitHub Actions:

| Workflow | File | What It Proves |
|----------|------|----------------|
| Detector Accuracy | `.github/workflows/detector-accuracy.yml` | 6/6 TP, 0/12 FP on 18 programs |
| Verifier | `.github/workflows/verify.yml` | 3 proven exploits with real tx signatures |

Trigger manually:
- GitHub → Actions → Select workflow → Run workflow → Branch: `main`

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `requireGroqApiKey` error in CI | Set `OTTER_SIGNALS_ONLY=1` — skips LLM |
| `cargo build-sbf` fails | Ensure Rust 1.75+, run `cargo update` in `fixtures/` |
| Validator not starting | Check port 8899 is free; `killall solana-test-validator` |
| Dataset missing | Run `npm run setup:dataset` |

## Versions (Pinned)

See `package.json` for exact Node package versions.
See `fixtures/Cargo.lock` for exact Rust dependency versions.
See `.github/workflows/` for CI runner versions.
