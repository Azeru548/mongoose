# Mongoose iteration 2 comparison

| Family | Variant | Baseline Flagged? | Mongoose Flagged? | Mongoose Class Correct? | Instruction Name |
|---|---|---|---|---|---|
| 0-signer-authorization | insecure | YES | YES | YES | log_message |
| 0-signer-authorization | recommended | YES | NO | N/A | — |
| 0-signer-authorization | secure | YES | NO | N/A | — |
| 1-account-data-matching | insecure | YES | YES | YES | log_message |
| 1-account-data-matching | recommended | YES | NO | N/A | — |
| 1-account-data-matching | secure | YES | YES | N/A | log_message |
| 2-owner-checks | insecure | YES | YES | YES | log_message |
| 2-owner-checks | recommended | YES | NO | N/A | — |
| 2-owner-checks | secure | YES | NO | N/A | — |
| 3-type-cosplay | insecure | NO | YES | YES | update_user |
| 3-type-cosplay | recommended | NO | NO | N/A | — |
| 3-type-cosplay | secure | NO | NO | N/A | — |
| 7-bump-seed-canonicalization | insecure | YES | YES | YES | set_value |
| 7-bump-seed-canonicalization | recommended | NO | NO | N/A | — |
| 7-bump-seed-canonicalization | secure | YES | NO | N/A | — |
| 8-pda-sharing | insecure | YES | YES | YES | withdraw_tokens |
| 8-pda-sharing | recommended | YES | NO | N/A | — |
| 8-pda-sharing | secure | NO | NO | N/A | — |

## Aggregates

| Metric | Baseline | Mongoose |
|---|---|---|
| True positives | 5/6 | 6/6 |
| False positives | 8/12 | 0/12 |
| Localization (instruction_name ≠ unknown) | n/a | 100% |

## Dropped findings (validation filter)

_None._

```
=== MONGOOSE ITERATION 2 SUMMARY ===
Programs evaluated: 18
In-scope vulnerable: 6 (insecure variants of the 6 families)
In-scope fixed: 12 (secure + recommended variants)
Baseline TP: 5/6 | FP: 8/12
Mongoose TP: 6/6 | FP: 0/12
Mongoose localization accuracy: 100%
API errors: 0 | Extraction failures: 0
Dropped findings by validation filter:
  (none)
Changelog ready: YES
```
