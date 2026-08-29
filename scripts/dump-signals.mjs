import { extractProgram } from "../tmp-run/extractor.ts";
import { computeRiskSignals } from "../tmp-run/signals.ts";
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("tmp-run", { recursive: true });
for (const f of ["types.ts", "util.ts", "cache.ts", "extractor.ts", "signals.ts"]) {
  writeFileSync(
    join("tmp-run", f),
    readFileSync(join("src", f), "utf8").replaceAll(".js", ".ts"),
  );
}

const root = "data/sealevel-attacks/programs";
const cases = [
  ["0-signer-authorization", "insecure"],
  ["0-signer-authorization", "recommended"],
  ["0-signer-authorization", "secure"],
  ["2-owner-checks", "insecure"],
  ["2-owner-checks", "recommended"],
  ["2-owner-checks", "secure"],
  ["3-type-cosplay", "insecure"],
  ["3-type-cosplay", "recommended"],
  ["3-type-cosplay", "secure"],
];

for (const [fam, v] of cases) {
  const s = extractProgram(join(root, fam, v, "src"));
  const sigs = computeRiskSignals(s);
  const bits = sigs
    .filter((x) => x.class1 || x.class2 || x.class3 || x.class4 || x.class5)
    .map(
      (x) =>
        `${x.account_name}[1=${x.class1} 2=${x.class2} 3=${x.class3} 4=${x.class4} 5=${x.class5}]`,
    );
  console.log(fam + "/" + v, bits.length ? bits.join(" | ") : "(no candidates)");
  console.log("  checks:", JSON.stringify(s.instructions[0]?.handler_checks));
}
