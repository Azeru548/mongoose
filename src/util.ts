import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import type { CliArgs } from "./types.js";

export function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function readUtf8(path: string): string {
  return readFileSync(path, "utf8");
}

export function writeJson(path: string, value: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function walkRsFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    let st;
    try {
      st = statSync(current);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      for (const entry of readdirSync(current)) {
        if (entry === "target" || entry === "node_modules") continue;
        stack.push(join(current, entry));
      }
    } else if (current.endsWith(".rs")) {
      out.push(current);
    }
  }
  return out.sort();
}

export function rel(from: string, to: string): string {
  return relative(from, to).replaceAll("\\", "/");
}

export function extractBlock(source: string, openBrace: number): string {
  if (source[openBrace] !== "{") {
    throw new Error(`expected '{' at ${openBrace}`);
  }
  let depth = 0;
  let inStr = false;
  for (let i = openBrace; i < source.length; i++) {
    const ch = source[i];
    const prev = i > 0 ? source[i - 1] : "";
    if (inStr) {
      if (ch === '"' && prev !== "\\") inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return source.slice(openBrace, i + 1);
    }
  }
  throw new Error("unbalanced braces while parsing Rust");
}

export function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
}

export function parseArgs(argv: string[]): CliArgs {
  const command = argv[2] ?? "help";
  const args: CliArgs = { command };
  for (let i = 3; i < argv.length; i++) {
    const token = argv[i];
    const next = argv[i + 1];
    switch (token) {
      case "--dataset":
        args.dataset = next;
        i++;
        break;
      case "--program":
        args.program = next;
        i++;
        break;
      case "--output":
        args.output = next;
        i++;
        break;
      case "--baseline":
        args.baseline = next;
        i++;
        break;
      case "--otter":
        args.otter = next;
        i++;
        break;
      case "--skip-verify":
        args.skipVerify = true;
        break;
      case "--in-scope":
        args.inScope = true;
        break;
      case "--families":
        args.families = (next ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        i++;
        break;
      case "--limit":
        args.limit = Number(next);
        i++;
        break;
      default:
        break;
    }
  }
  return args;
}

export function flag(name: string, value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}
