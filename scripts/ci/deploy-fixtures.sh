#!/usr/bin/env bash
# Build + deploy Mongoose CI fixtures to a local solana-test-validator.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIX="$ROOT/fixtures"
OUT="$ROOT/output"
RPC="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
mkdir -p "$OUT" "$FIX/target/deploy"

echo "==> Waiting for validator at $RPC"
for i in $(seq 1 60); do
  if solana cluster-version --url "$RPC" >/dev/null 2>&1; then
    break
  fi
  sleep 1
  if [[ $i -eq 60 ]]; then
    echo "validator not reachable" >&2
    exit 1
  fi
done

# Ensure wallet
if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  mkdir -p "$HOME/.config/solana"
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json" --force
fi
solana config set --url "$RPC"
solana airdrop 50 || true
sleep 2
solana airdrop 50 || true

# Copy committed keypairs into Anchor deploy path
for name in missing_signer missing_owner type_cosplay; do
  cp "$FIX/keys/${name}-keypair.json" "$FIX/target/deploy/${name}-keypair.json"
done

echo "==> Building fixtures with Anchor"
cd "$FIX"
anchor build

MAP="$OUT/deploy-map.json"
echo '{}' > "$MAP"

deploy_one() {
  local name="$1"
  local so="$FIX/target/deploy/${name}.so"
  local kp="$FIX/target/deploy/${name}-keypair.json"
  if [[ ! -f "$so" ]]; then
    echo "missing $so" >&2
    exit 1
  fi
  local pid
  pid="$(solana-keygen pubkey "$kp")"
  echo "==> Deploying $name ($pid)"
  solana program deploy "$so" --program-id "$kp" --url "$RPC"
  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'fs';
    const map = JSON.parse(readFileSync('$MAP','utf8'));
    map['$name'] = {
      programId: '$pid',
      soPath: '$so',
      keypairPath: '$kp',
      caseIds: [],
    };
    writeFileSync('$MAP', JSON.stringify(map, null, 2) + '\n');
  "
}

deploy_one missing_signer
deploy_one missing_owner
deploy_one type_cosplay

# Map sealevel case ids onto fixtures for mixed runs
node --input-type=module -e "
  import { readFileSync, writeFileSync } from 'fs';
  const map = JSON.parse(readFileSync('$MAP','utf8'));
  map.missing_signer.caseIds = ['0-signer-authorization/insecure'];
  map.missing_owner.caseIds = ['2-owner-checks/insecure'];
  map.type_cosplay.caseIds = ['3-type-cosplay/insecure'];
  map.byCaseId = {
    '0-signer-authorization/insecure': 'missing_signer',
    '2-owner-checks/insecure': 'missing_owner',
    '3-type-cosplay/insecure': 'type_cosplay',
  };
  writeFileSync('$MAP', JSON.stringify(map, null, 2) + '\n');
"

echo "==> Deploy map written to $MAP"
cat "$MAP"
