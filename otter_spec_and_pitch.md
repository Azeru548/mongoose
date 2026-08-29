# Otter
### An Agent That Proves Vulnerabilities — Not Just Guesses Them

*micro1 Agentic Workflows Hackathon Submission*

---

## 1. Product Pitch

### Tagline
**Every scanner tells you "this looks broken." Otter shows you the transaction that broke it.**

### The Problem (Framed Universally)
Static analysis is the first line of defense in every domain — code, infrastructure, security. But every developer knows the same pain: you run the scanner, get 50 warnings, and have no way to tell which 5 are real without manual investigation. The tool dumps suspicion on you. It never closes the loop.

In smart contract security, this gap is expensive. A static analyzer flags a "missing signer check." Maybe it's a real hole. Maybe the check happens two frames up the call stack. The only way to know is to manually trace the code — or try the attack and see if it works. Most solo developers can't afford a $15k+ professional audit, so they either skip review entirely or drown in unverified warnings.

### Who Feels This
Solo developers and small teams shipping Solana Anchor programs without an audit budget. They need a security signal they can trust and act on.

### The Insight
Detection and proof are different problems. A flag is a hypothesis. An exploit transaction is evidence. If you can't verify the hypothesis automatically, you haven't solved the problem — you've just moved the manual work upstream.

### What Otter Does
Given an Anchor program, Otter runs a three-stage pipeline:

1. Extracts a structured account/instruction map (deterministic parsing, no guesswork)
2. Flags candidate vulnerabilities against a Solana-specific taxonomy (LLM reasoning with grounded context)
3. Verifies each flag by constructing and submitting an actual exploit transaction against a local sandboxed validator

The final report splits findings into two tiers:
- **Proven:** Exploit succeeded. Here is the transaction signature, the account state diff, and the exact instruction path.
- **Suspected:** Flagged by the Detector but not confirmed by the Verifier. Here is the reasoning and the blocker.

### Why This Wins (Rubric Mapping)

| Rubric Criterion | How Otter Delivers |
|---|---|
| Problem & User Value (15) | Sharp user definition (solo Anchor devs). Real bottleneck (unverified scanner output). High stakes (financial loss from missed bugs). |
| Agent Solution & Engineering (30) | Three-stage pipeline where each stage catches the previous stage's failure mode. Purposeful use of deterministic tools + LLM + dynamic verification + a persistent false-positive memory. Not three agents for show — three agents because each solves a different sub-problem. |
| End to End Quality (20) | Output is a developer-ready report with proven exploit transactions, not an AI-generated essay. A user would paste the "Proven" section into a GitHub issue and assign it. |
| Measured Improvement (15) | Fair baseline (generic LLM prompt, no domain context, no verification). Same 30 test cases for both. Quantified TP/FP rates + proof coverage. |
| Reproducibility (15) | Single-language TypeScript codebase. Exact CLI/package versions pinned. One-command evaluation. Public dataset (sealevel-attacks). |
| Hot Take / Insights (5) | Static detection caps out on PDA seed bugs because the flaw only reveals under derivation. Dynamic verification is required for true confidence, but it isn't generically applicable to all bug classes. The lesson: security tools need tiered confidence, not binary pass/fail. |

---

## 2. Competitive Landscape

| Tool | What It Does | Gap Otter Fills |
|---|---|---|
| **Soteria** | Static pattern-matching, CI integration | Flags patterns; does not attempt or confirm exploitation |
| **Sec3 X-ray** | Static analysis for Solana | Same gap: suspicion without proof |
| **Manual Audits (OtterSec, Neodyme)** | Gold standard, human review | Inaccessible to solo devs ($15k+, weeks of scheduling) |
| **Generic LLM Prompt** | "Find bugs in this code" | No Solana-specific account-model knowledge; high false-negative rate on Sealevel-specific issues; no verification |
| **Otter** | Structured extraction + Solana-specific detection + live exploit verification | Every "Proven" finding is backed by an actual transaction, not a guess |

---

## 3. Target Vulnerability Classes (v1 Scope)

Sourced from Neodyme's **sealevel-attacks** — the reference dataset for known Solana program vulnerabilities.

| # | Class | Description | Verifier Coverage |
|---|---|---|---|
| 1 | Missing signer check | Instruction doesn't verify the expected authority actually signed | Full — construct transaction with unsigned account |
| 2 | Missing owner check | Program doesn't verify an account is owned by the expected program | Full — pass account with wrong owner |
| 3 | Account type confusion ("type cosplay") | Program accepts an account of the wrong type due to missing discriminator check | Full — pass account with valid owner but wrong type |
| 4 | Missing relationship constraint (`has_one`) | Program doesn't verify two accounts are actually linked as expected | Suspected-only — requires complex state setup; Verifier attempts but may not confirm |
| 5 | Insecure PDA seeds | Seeds allow derivation of colliding accounts | Suspected-only — static detection + reasoning; dynamic proof requires custom derivation logic per program |

**Scoping decision:** Classes 1-3 get full Verifier coverage because the exploit is a single malformed transaction. Classes 4-5 are flagged as "Suspected" with detailed reasoning. This is honest about the boundary between what static+reasoning can flag and what dynamic proof can confirm within a solo time budget.

---

## 4. System Architecture

**Design principle:** each stage is independently gradeable. If the Extractor is wrong, the Detector's input is garbage — you can catch that in isolation. If the Detector over-flags, the Verifier filters false positives before they reach the user. This is purposeful orchestration, not complexity for its own sake.

```
Anchor Program (.rs)
        |
        v
[1] EXTRACTOR (deterministic tool, NOT an LLM)
    - Parses account structs, instruction handlers, #[account(...)] constraints
    - Outputs a structured JSON summary per instruction
        |
        v
[2] DETECTOR (LLM agent)
    - Input: structured summary + 5-class vulnerability taxonomy
    - Output: candidate findings — class, instruction, account, reasoning, confidence
        |
        v
[3] VERIFIER (dynamic execution, NOT an LLM)
    - Spins up a local solana-test-validator
    - For each candidate in Classes 1-3: constructs and submits an actual exploit transaction
    - Records result: PROVEN (exploit succeeded) or UNCONFIRMED (failed / not attempted)
    - For Classes 4-5: marks UNCONFIRMED with reasoning
        |
        v
FINAL REPORT
    - Proven findings: vulnerability class, location, exploit transaction, before/after account state
    - Suspected findings: flagged but not proven, with Detector reasoning and Verifier notes
```

### Stack (TypeScript end-to-end)

| Component | Tooling |
|---|---|
| Extractor | `web-tree-sitter` + `tree-sitter-rust` grammar, run in Node/TypeScript — a real, working way to get a Rust AST without leaving the TS ecosystem (this replaces the earlier draft's broken suggestion of using `syn`, a Rust-only crate, "from Python") |
| Detector | TypeScript, calling an LLM via the Anthropic or OpenAI SDK |
| Verifier | TypeScript, `@solana/web3.js` + `@coral-xyz/anchor` against a local `solana-test-validator` |
| Orchestration / CLI | TypeScript, `ts-node` scripts, single `package.json` |

**Why this fixes the earlier version's error:** the previous draft said "use `syn` in Python via tree-sitter or regex fallback" — that's three incompatible approaches collapsed into one sentence (`syn` is a Rust-only crate; it has no Python binding). Standardizing on TypeScript end-to-end with `tree-sitter-rust`'s Node bindings removes the ambiguity and means you're not context-switching languages mid-pipeline.

---

### [1] Extractor

**Type:** Deterministic TypeScript module (no LLM)
**Purpose:** Remove noise. LLMs are unreliable at reading raw Rust macros — parse them deterministically so the Detector works with structured data, not raw text.

**Inputs:** Path to an Anchor program directory (`programs/my_program/src/`)

**Outputs:**
```json
{
  "program_id": "my_program",
  "instructions": [
    {
      "name": "initialize",
      "accounts": [
        { "name": "user", "is_signer": true, "is_mut": false, "owner_constraint": null, "has_one": null },
        { "name": "config", "is_signer": false, "is_mut": true, "owner_constraint": "program_id", "has_one": "authority = user" }
      ],
      "constraint_summary": "user must sign; config must be owned by this program; config.authority must match user"
    }
  ]
}
```

**Implementation:**
- Parse Rust source with `web-tree-sitter` using the `tree-sitter-rust` grammar
- Walk the AST for `#[derive(Accounts)]` structs and their `#[account(...)]` attributes: `has_one`, `owner`, `address`, `signer`, `mut`
- Map each account to its constraints
- If parsing fails, emit an explicit error — do not guess

**Failure mode:** if the Extractor fails, the pipeline halts. The Detector never runs on garbage input.

---

### [2] Detector

**Type:** LLM agent (TypeScript, calling Claude or GPT via SDK)
**Purpose:** Reason about vulnerability classes using structured context, not raw code.

**System prompt (draft):**
```
You are a Solana security analyst. You receive a structured JSON summary of an
Anchor program's instructions and accounts. Identify candidate vulnerabilities
from the following taxonomy:

1. Missing signer check — an account that should require a signature lacks
   is_signer=true or an explicit signer constraint.
2. Missing owner check — an account lacks an owner constraint, allowing a
   malicious user to pass an account owned by a different program.
3. Account type confusion — an account lacks a discriminator check, allowing
   a user to pass an account of the wrong type that meets other constraints.
4. Missing relationship constraint (has_one) — two accounts should be linked
   but the constraint is missing or incomplete.
5. Insecure PDA seeds — a PDA is derived with predictable or user-controlled
   seeds that allow collision.

For each finding, output: vulnerability_class, instruction_name, account_name,
reasoning (2-3 sentences), confidence (HIGH/MEDIUM/LOW).

Be conservative. If a constraint exists in the structured summary, do NOT
flag it as missing. Only flag what is actually absent.
```

**Outputs:**
```json
[
  {
    "vulnerability_class": 1,
    "instruction_name": "withdraw",
    "account_name": "authority",
    "reasoning": "The 'authority' account is not marked is_signer=true and no explicit signer check appears in the constraint_summary.",
    "confidence": "HIGH"
  }
]
```

**Failure mode:** the Detector may hallucinate missing checks or miss subtle ones. The Verifier catches false positives; the changelog tracks Detector precision per iteration.

---

### [3] Verifier

**Type:** Dynamic execution engine (TypeScript, `@solana/web3.js` + `@coral-xyz/anchor`)
**Purpose:** Close the loop. Turn suspicion into proof.

**Architecture:**
- Local `solana-test-validator`, deployed target program, ephemeral test accounts created on startup
- For each Detector candidate:
  - **Class 1 (Missing signer):** build a transaction calling the instruction with the target account's signature omitted. If it succeeds → **PROVEN**.
  - **Class 2 (Missing owner):** build a transaction with the target account owned by the System Program (or a fake program) instead of the expected one. If it succeeds → **PROVEN**.
  - **Class 3 (Type confusion):** build a transaction passing an account with the correct owner but wrong data layout/discriminator. If accepted → **PROVEN**.
  - **Classes 4-5:** mark **UNCONFIRMED**. Document why (e.g., "requires multi-instruction state setup beyond current automation").

**Output per candidate:**
```json
{
  "vulnerability_class": 1,
  "instruction_name": "withdraw",
  "account_name": "authority",
  "verdict": "PROVEN",
  "exploit_transaction": "5UfgJ5...",
  "pre_state": { "account_balance": 1000000 },
  "post_state": { "account_balance": 0 },
  "notes": "Transaction succeeded without authority signature. Funds drained."
}
```

**Failure mode:** if the Verifier crashes or the validator fails to start, the candidate defaults to UNCONFIRMED. The pipeline degrades gracefully — it doesn't crash.

---

### Memory & State

- **Extractor cache:** parsed JSON summaries cached per program commit hash to avoid reparsing
- **Detector memory:** a "known false positive" registry — if a finding was proven UNCONFIRMED on a previous run (e.g., the signer check exists but is in a pattern the Extractor missed), the Detector is instructed to avoid re-flagging it. Updated as you iterate.
- **Verifier state:** the local validator is ephemeral. No state persists between runs — each evaluation is clean.

---

## 5. Baseline & Evaluation Protocol

### Baseline
A single, generic prompt with no Solana-specific context, no structured extraction, and no verification:
> "Review the following Rust code for security vulnerabilities. List any issues you find."

The baseline receives the raw `.rs` files. It does not know the 5-class taxonomy. It does not attempt exploits.

### Test Set
- Source: `neodyme-labs/sealevel-attacks`
- Structure: 5 vulnerability classes × 3 paired examples (vulnerable + fixed) = 15 vulnerable programs + 15 fixed programs = **30 total test cases**
- One deliberately hard case: the PDA seed collision example (Class 5) — it looks syntactically correct and requires understanding account derivation logic to catch. Report how both baseline and Otter handle it, even if Otter also misses it.

### Metrics

| Metric | Baseline | Otter | What It Shows |
|---|---|---|---|
| True positive rate (vulnerable programs correctly flagged) | ? | ? | Raw detection capability |
| False positive rate (fixed programs incorrectly flagged) | ? | ? | Precision — does it cry wolf? |
| Instruction-level localization accuracy | ? | ? | Is the finding actionable or vague? |
| % of true positives with a proven exploit transaction | N/A (can't verify) | ? | Core differentiator |
| Average runtime per program | ? | ? | Practicality for CI integration |

### Evaluation Commands
```bash
# Clone the dataset
git clone https://github.com/neodyme-labs/sealevel-attacks.git

# Install dependencies
npm install

# Run baseline
npm run baseline -- --dataset ./sealevel-attacks --output baseline_results.json

# Run Otter
npm run otter -- --dataset ./sealevel-attacks --output otter_results.json

# Generate comparison table
npm run evaluate -- --baseline baseline_results.json --otter otter_results.json
```

---

## 6. Improvement Changelog

| Stage | What You Tried and Why | Evidence | Decision / Learning |
|---|---|---|---|
| Baseline | Generic "find bugs" prompt, no Solana context, raw code input | TP/FP rates on 30 test cases | Established the floor. Expect it to miss Sealevel-specific issues and hallucinate generic Rust bugs. |
| Iteration 1 | Added the 5-class vulnerability taxonomy as context to the Detector prompt | TP/FP rates | Detection improved for Solana-specific patterns. Watch for false positives on fixed versions where the check exists but is non-obvious. |
| Iteration 2 | Replaced raw code input with structured Extractor output (tree-sitter JSON summary) | TP/FP rates + localization accuracy | False positives dropped. Detector no longer misses constraints hidden in Anchor macros. Localization improved from "somewhere in the program" to specific instruction/account. |
| Iteration 3 | Added dynamic Verifier for Classes 1-3 | % proven vs. suspected | Key differentiator. Separates confirmed bugs from guesses. Some candidates failed verification because the Detector misread the Extractor output — caught a new failure mode. |
| Iteration 4 (Discarded) | Attempted full Verifier coverage for Classes 4-5 | Validator setup too complex per program; multi-instruction state setup unreliable within time budget | Cut scope honestly. Classes 4-5 remain "Suspected" with reasoning. A partial but working Verifier is stronger than a broken full one. |
| Final | Combined pipeline: Extractor → Detector → Verifier (Classes 1-3) | Full comparison table | Main contribution: verification, not just detection. The gap between "flagged" and "proven" is the entire value proposition. |

---

## 7. Agent Trajectories (Representative Example)

**Program:** `missing_signer_check` (vulnerable)

**[1] Extractor**
```json
{
  "instructions": [
    {
      "name": "withdraw",
      "accounts": [
        { "name": "user", "is_signer": false, "is_mut": false },
        { "name": "vault", "is_signer": false, "is_mut": true }
      ],
      "constraint_summary": "No signer constraints listed"
    }
  ]
}
```

**[2] Detector**
```json
[
  {
    "vulnerability_class": 1,
    "instruction_name": "withdraw",
    "account_name": "user",
    "reasoning": "The 'user' account has is_signer=false and there is no explicit signer constraint. In a withdrawal instruction, the user should be signing to authorize the transfer.",
    "confidence": "HIGH"
  }
]
```

**[3] Verifier**
```json
{
  "vulnerability_class": 1,
  "instruction_name": "withdraw",
  "account_name": "user",
  "verdict": "PROVEN",
  "exploit_transaction": "4xZv...",
  "pre_state": { "vault_balance": 5000000 },
  "post_state": { "vault_balance": 0 },
  "notes": "Called withdraw with a random keypair as 'user' (no signature required). Vault drained successfully."
}
```

**Final report snippet:**
```
[PROVEN] Missing Signer Check in `withdraw`
Location: instruction `withdraw`, account `user`
Evidence: Transaction 4xZv... succeeded without user signature.
Impact: Any account can drain the vault.
Fix: Add `#[account(signer)]` or is_signer=true to the user account.
```

---

## 8. Reproduction Guide

### Prerequisites
- Node.js 20.x
- Solana CLI + Anchor CLI (for local validator + program deployment)
- Git

### Setup
```bash
git clone https://github.com/yourusername/otter.git
cd otter
npm install
```

### Run
```bash
# Full pipeline on the test set
npm run otter -- --dataset ./data/sealevel-attacks --output ./output/otter_results.json

# Baseline only
npm run baseline -- --dataset ./data/sealevel-attacks --output ./output/baseline_results.json

# Comparison report
npm run evaluate -- --baseline ./output/baseline_results.json --otter ./output/otter_results.json
```

**Build-order recommendation:** get the Extractor → Detector → Verifier loop working directly against a local `solana-test-validator` first. Only containerize with Docker once the core pipeline is provably correct — validator networking inside Docker is a common, avoidable time sink in a 1-2 week solo window.

### Expected Output
- `baseline_results.json` — findings per program, no verification
- `otter_results.json` — findings with `verdict: PROVEN | UNCONFIRMED`
- `comparison_table.md` — TP/FP rates and proof coverage
- Runtime: ~15-30 minutes for 30 programs (validator spin-up dominates)

### Versions (Pinned)
- Node: 20.11.0
- TypeScript: 5.4.x
- `@solana/web3.js`: 1.91.x
- `@coral-xyz/anchor`: 0.29.0
- Solana CLI: 1.18.0
- Anchor CLI: 0.29.0
- `web-tree-sitter` + `tree-sitter-rust`: latest compatible pair

---

## 9. Ground Rules Compliance

| Rule | Compliance |
|---|---|
| Sandboxed execution | All exploit attempts run against a local `solana-test-validator` with no network access. No transactions touch devnet, testnet, or mainnet. |
| Human review | Final report is a recommendation for developer review, not an automated "safe/unsafe" verdict. The human decides whether to act. |
| Legal/ethical use case | Uses only public educational data (sealevel-attacks, openly licensed). No real user funds or private data. |
| Credentials | No private keys, API tokens, or wallet seeds in the repo. The test validator generates ephemeral keypairs on startup. |
| Claims tied to evidence | Every "Proven" finding includes the actual exploit transaction signature and account state diff. Every "Suspected" finding includes the Detector's reasoning. |

---

## 10. Hot Take

Static pattern-matching and dynamic proof disagree most often on PDA seed-related bugs: a seed derivation can look completely correct by inspection and only reveals its flaw when you actually try to derive a colliding account. This suggests that for any security tool — Solana or otherwise — static detection alone caps out below where dynamic verification can reach. The ecosystem's own account model resists purely textual analysis.

The broader lesson: security agents should not output binary pass/fail. They should output tiered confidence — Proven, Suspected, and Clean. The gap between "flagged" and "proven" is where the real engineering lives. Building a tool that knows the difference — and is honest about what it cannot prove — is more valuable than one that confidently guesses wrong.

---

## 11. Realistic Time Budget (Solo, 1-2 Week Window)

| Days | Task | Fallback If Behind |
|---|---|---|
| 1-2 | Extractor tool (tree-sitter-rust in TypeScript) + pull/organize sealevel-attacks test set | Fall back to a regex-based extraction pass for the few constraint patterns actually used in the test set if AST walking takes too long |
| 3-5 | Detector agent + taxonomy authoring + baseline run | Cut taxonomy to 3 classes if prompt engineering takes too long |
| 6-9 | Verifier for Classes 1-3, run locally (no Docker yet) | If validator scripting is unstable, cut to Classes 1-2 only |
| 10-12 | Full eval run, changelog write-up, README | Skip fancy UI; output is JSON + Markdown report |
| 13-14 | Video, agent trajectory writeups, final polish | Record video on a subset of 5 programs if 30 is too slow |

**If time runs short:** cut Verifier coverage to 2 classes and say so explicitly. A pipeline that's honest about partial proof coverage scores better than one that fakes full coverage.

---

*Document Version: 2.0 | Target: micro1 Agentic Workflows Hackathon*
