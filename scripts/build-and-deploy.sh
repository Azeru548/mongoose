#!/usr/bin/env bash
# Build + deploy Class 1-3 insecure fixtures (+ signer secure control).
# Writes output/deployed_programs.json mapping family/variant -> programId.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FIX="$ROOT/fixtures"
OUT="$ROOT/output"
RPC="${SOLANA_RPC_URL:-http://127.0.0.1:8899}"
mkdir -p "$OUT" "$FIX/target/deploy" "$OUT/keys"

# Remove old lockfiles that break cargo build-sbf (v4 vs Solana's older Cargo)
rm -f "$FIX/Cargo.lock" 2>/dev/null || true
find "$FIX" -name "Cargo.lock" -delete 2>/dev/null || true

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
rm -f "$FIX/Cargo.lock"

downgrade_lockfile() {
  local lf="$FIX/Cargo.lock"
  if [[ -f "$lf" ]] && grep -q "^version = 4" "$lf"; then
    echo "    downgrading Cargo.lock v4 -> v3 for Solana platform-tools"
    sed -i.bak -E 's/^version = 4/version = 3/' "$lf"
    rm -f "${lf}.bak"
  fi
}

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
  rm -f "$FIX/$CRATE_REL/Cargo.lock"
  rm -f "$FIX/Cargo.lock"
  # Build from program dir to bypass workspace patch/lock issues
  pushd "$FIX/$CRATE_REL" >/dev/null
  # Nuclear: clear any patch that breaks modern cargo (Anchor 0.29 quirk)
  # (workspace patch already removed, but keep as safety)
  export PATH="$HOME/.cargo/bin:$PATH"
  rustup default stable
  set +e
  cargo +stable build-sbf 2>&1 | tee /tmp/build-${CRATE_NAME}.log
  BUILD_RC=${PIPESTATUS[0]}
  if [[ $BUILD_RC -ne 0 ]]; then
    echo "    cargo +stable build-sbf failed (rc=$BUILD_RC), trying +nightly..." >&2
    cat /tmp/build-${CRATE_NAME}.log >&2
    cargo +nightly build-sbf 2>&1 | tee /tmp/build-${CRATE_NAME}.log
    BUILD_RC=${PIPESTATUS[0]}
  fi
  if [[ $BUILD_RC -ne 0 ]]; then
    echo "    both +stable/+nightly failed, trying dependency pinning + retry..." >&2
    cat /tmp/build-${CRATE_NAME}.log >&2
    cargo update -p zeroize_derive --precise 1.4.2 2>/dev/null || true
    cargo update -p zeroize --precise 1.7.0 2>/dev/null || true
    cargo update -p crypto-common --precise 0.1.6 2>/dev/null || true
    cargo +stable build-sbf 2>&1 | tee /tmp/build-${CRATE_NAME}.log
    BUILD_RC=${PIPESTATUS[0]}
  fi
  set -e
  popd >/dev/null
  if [[ $BUILD_RC -ne 0 ]]; then
    if grep -q "lock file version 4 requires" /tmp/build-${CRATE_NAME}.log; then
      downgrade_lockfile
      echo "    retrying cargo build-sbf after downgrade..."
      pushd "$FIX/$CRATE_REL" >/dev/null
      export PATH="$HOME/.cargo/bin:$PATH"
      rustup default stable
      cargo +stable build-sbf
      popd >/dev/null
    elif grep -q "failed to parse manifest" /tmp/build-${CRATE_NAME}.log && grep -q "edition2024" /tmp/build-${CRATE_NAME}.log; then
      echo "    edition2024 error — trying cargo update + retry..." >&2
      rm -f "$FIX/$CRATE_REL/Cargo.lock" "$FIX/Cargo.lock"
      pushd "$FIX/$CRATE_REL" >/dev/null
      export PATH="$HOME/.cargo/bin:$PATH"
      cargo update 2>/dev/null || true
      cargo +stable build-sbf
      popd >/dev/null
    else
      echo "cargo build-sbf failed (see /tmp/build-${CRATE_NAME}.log)" >&2
      cat /tmp/build-${CRATE_NAME}.log >&2
      exit $BUILD_RC
    fi
  fi

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
