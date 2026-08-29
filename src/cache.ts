import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProgramSummary } from "./types.js";
import { ensureDir, writeJson } from "./util.js";

const CACHE_DIR = join(process.cwd(), "cache", "extractor");

export function loadExtractorCache(hash: string): ProgramSummary | null {
  const path = join(CACHE_DIR, `${hash}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as ProgramSummary;
}

export function saveExtractorCache(summary: ProgramSummary): void {
  ensureDir(CACHE_DIR);
  writeJson(join(CACHE_DIR, `${summary.source_hash}.json`), summary);
}
