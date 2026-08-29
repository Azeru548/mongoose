#!/usr/bin/env bash
# Build + deploy Class 1â€“3 insecure fixtures (+ signer secure control).
# Writes output/deployed_programs.json mapping family/variant â†’ programId.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$ROOT/fixtures"
OUT="$ROOT/output"
RPC="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
mkdir -p "$OUT" "$FIX/target/deploy" "$OUT/keys"

echo "==> Waiting for validator health at $RPC"
for i in $(seq 1 90); do
  if curl -sf "$RPC/health" | grep -q ok; then
    echo "validator healthy"
    break
  fi
  if solana cluster-version --url "$RPC" >/dev/null 2>&1; then
    echo "validator reachable via solana CLI"
    break
  fi
  sleep 1
  if [[ $i -eq 90 ]]; then
    echo "validator not ready" >&2
    exit 1
  fi
done

if [[ ! -f "$HOME/.config/solana/id.json" ]]; then
  mkdir -p "$HOME/.config/solana"
  solana-keygen new --no-bip39-passphrase -o "$HOME/.config/solana/id.json" --force
fi
solana config set --url "$RPC"
solana airdrop 100 || true
sleep 1
solana airdrop 100 || true

# family/variant|crate_dir|crate_name|expected_class|expect_proven
PROGRAMS=(
  "0-signer-authorization/insecure|programs/missing_signer|missing_signer|1|true"
  "0-signer-authorization/secure|programs/missing_signer_secure|missing_signer_secure|1|false"
  "2-owner-checks/insecure|programs/missing_owner|missing_owner|2|true"
  "3-type-cosplay/insecure|programs/type_cosplay|type_cosplay|3|true"
)

DEPLOYED="$OUT/deployed_programs.json"
echo '{}' > "$DEPLOYED"

cd "$FIX"

for entry in "${PROGRAMS[@]}"; do
  IFS='|' read -r CASE_ID CRATE_REL CRATE_NAME EXPECT_CLASS EXPECT_PROVEN <<<"$entry"
  SRC="$FIX/$CRATE_REL/src/lib.rs"
  KP_OUT="$OUT/keys/${CRATE_NAME}-keypair.json"
  KP_DEPLOY="$FIX/target/deploy/${CRATE_NAME}-keypair.json"

  echo ""
  echo "==> Building $CASE_ID ($CRATE_NAME)"
  solana-keygen new --no-bip39-passphrase -o "$KP_OUT" --force
  PUBKEY="$(solana-keygen pubkey "$KP_OUT")"
  echo "    program id: $PUBKEY"

  # Replace declare_id!("..."); in lib.rs using sed
  sed -i.bak -E "s/declare_id!\(\"[^\"]+\"\);/declare_id!(\"$PUBKEY\");/" "$SRC"
  rm -f "${SRC}.bak"
  echo "    patched declare_id in $SRC"

  # Keep Anchor.toml in sync for this crate
  sed -i.bak -E "s/(${CRATE_NAME}[[:space:]]*=[[:space:]]*\")[^\"]+(\")/\1${PUBKEY}\2/" "$FIX/Anchor.toml"
  rm -f "${FIX}/Anchor.toml.bak"
  echo "    patched Anchor.toml for $CRATE_NAME"

  cp "$KP_OUT" "$KP_DEPLOY"
  anchor build -p "$CRATE_NAME"

  SO="$FIX/target/deploy/${CRATE_NAME}.so"
  if [[ ! -f "$SO" ]]; then
    echo "missing $SO" >&2
    exit 1
  fi

  echo "==> Deploying $CASE_ID"
  solana program deploy "$SO" --program-id "$KP_DEPLOY" --url "$RPC"

  node --input-type=module -e "
    import { readFileSync, writeFileSync } from 'fs';
    const path = '$DEPLOYED';
    const map = JSON.parse(readFileSync(path, 'utf8'));
    map['$CASE_ID'] = {
      programId: '$PUBKEY',
      soPath: '$SO',
      keypairPath: '$KP_OUT',
      sourceDir: '$FIX/$CRATE_REL/src',
      crateName: '$CRATE_NAME',
      expectedClass: $EXPECT_CLASS,
      expectProven: $EXPECT_PROVEN,
    };
    writeFileSync(path, JSON.stringify(map, null, 2) + '\n');
  "
done

echo ""
echo "==> deployed_programs.json"
cat "$DEPLOYED"
