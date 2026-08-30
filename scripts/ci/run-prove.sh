#!/usr/bin/env bash
# Run Mongoose Detector (signals-only) + Verifier against deployed fixtures.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

export SOLANA_RPC_URL="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
export OTTER_DEPLOY_MAP="${OTTER_DEPLOY_MAP:-$ROOT/output/deploy-map.json}"
export OTTER_SIGNALS_ONLY="${OTTER_SIGNALS_ONLY:-1}"

mkdir -p output/ci

run_one() {
  local name="$1"
  local src="fixtures/programs/${name}/src"
  local out="output/ci/otter_${name}.json"
  echo "==> Otter prove: $name"
  npx tsx src/index.ts otter --program "$src" --output "$out"
  node --input-type=module -e "
    import { readFileSync } from 'fs';
    const r = JSON.parse(readFileSync('$out','utf8'));
    const proven = (r.findings || []).filter(f => f.verdict === 'PROVEN');
    console.log('proven', proven.length, proven.map(f => f.vulnerability_class + ':' + f.exploit_transaction).join(', '));
    if (proven.length < 1) {
      console.error('EXPECTED at least one PROVEN finding for $name');
      console.error(JSON.stringify(r, null, 2));
      process.exit(1);
    }
  "
}

run_one missing_signer
run_one missing_owner
run_one type_cosplay

# Merge reports
node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'fs';
  const names = ['missing_signer','missing_owner','type_cosplay'];
  const results = names.map(n => JSON.parse(readFileSync('output/ci/otter_'+n+'.json','utf8')));
  writeFileSync('output/ci/otter_ci.json', JSON.stringify(results, null, 2) + '\n');
  const proven = results.flatMap(r => (r.findings||[]).filter(f => f.verdict==='PROVEN'));
  writeFileSync('output/ci/proven.json', JSON.stringify(proven, null, 2) + '\n');
  console.log('TOTAL PROVEN', proven.length);
"
