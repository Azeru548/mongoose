import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const files = ["types.ts", "util.ts", "cache.ts", "extractor.ts", "selftest.ts"];
mkdirSync("tmp-run", { recursive: true });
for (const f of files) {
  const src = readFileSync(join("src", f), "utf8").replaceAll(".js", ".ts");
  writeFileSync(join("tmp-run", f), src);
}

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", "tmp-run/selftest.ts"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
