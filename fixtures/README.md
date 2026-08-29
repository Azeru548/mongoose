# Otter CI verifier fixtures

Minimal **Anchor 0.29** programs that mirror sealevel-attacks Classes 1–3. Used by GitHub Actions because upstream `coral-xyz/sealevel-attacks` targets Anchor **0.20** and is painful to build on modern toolchains.

| Crate | Class | Vulnerability |
|---|---|---|
| `missing_signer` | 1 | `authority` is `UncheckedAccount` (no signer) |
| `missing_owner` | 2 | `data` is `UncheckedAccount` (no owner check) |
| `type_cosplay` | 3 | `user` is `UncheckedAccount` (no discriminator) |

Keypairs under `keys/` are **test-only** (no value). CI copies them to `target/deploy/` before `anchor build` / `solana program deploy`.
