import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { CaseLabel, DatasetCase, VulnClass } from "./types.js";

/** Maps sealevel-attacks families onto Mongoose's v1 taxonomy. */
export const CLASS_BY_FAMILY: Record<string, VulnClass> = {
  "0-signer-authorization": 1,
  "2-owner-checks": 2,
  "3-type-cosplay": 3,
  "1-account-data-matching": 4,
  "7-bump-seed-canonicalization": 5,
  "8-pda-sharing": 5,
};

function labelForVariant(variant: string): CaseLabel {
  return variant.startsWith("insecure") ? "vulnerable" : "fixed";
}

export function discoverCases(datasetRoot: string): DatasetCase[] {
  const programsDir = existsSync(join(datasetRoot, "programs"))
    ? join(datasetRoot, "programs")
    : datasetRoot;

  if (!existsSync(programsDir)) {
    throw new Error(`dataset not found: ${datasetRoot}`);
  }

  const cases: DatasetCase[] = [];
  for (const family of readdirSync(programsDir).sort()) {
    const familyDir = join(programsDir, family);
    if (!statSync(familyDir).isDirectory()) continue;
    if (family.startsWith(".")) continue;

    const expected = CLASS_BY_FAMILY[family] ?? null;
    const inScope = expected !== null;

    for (const variant of readdirSync(familyDir).sort()) {
      const variantDir = join(familyDir, variant);
      if (!statSync(variantDir).isDirectory()) continue;
      const srcDir = existsSync(join(variantDir, "src"))
        ? join(variantDir, "src")
        : variantDir;
      cases.push({
        id: `${family}/${variant}`,
        family,
        variant,
        label: labelForVariant(variant),
        expected_class: expected,
        in_scope: inScope,
        program_dir: srcDir,
      });
    }
  }

  if (cases.length === 0) {
    throw new Error(`no programs found under ${datasetRoot}`);
  }
  return cases;
}

export function selectCases(
  cases: DatasetCase[],
  opts: { inScope?: boolean; families?: string[]; limit?: number } = {},
): DatasetCase[] {
  let selected = cases;
  if (opts.families && opts.families.length > 0) {
    const allow = new Set(opts.families);
    selected = selected.filter((c) => allow.has(c.family));
  } else if (opts.inScope) {
    selected = selected.filter((c) => c.in_scope);
  }
  if (opts.limit && opts.limit > 0) selected = selected.slice(0, opts.limit);
  return selected;
}

export function singleProgramCase(programDir: string): DatasetCase {
  const name = basename(programDir);
  return {
    id: name,
    family: name,
    variant: "adhoc",
    label: "vulnerable",
    expected_class: null,
    in_scope: false,
    program_dir: programDir,
  };
}
