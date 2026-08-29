import { readUtf8, walkRsFiles } from "./util.js";
import { baselineModel, completeJson } from "./llm.js";
import type { DatasetCase, Finding } from "./types.js";
import { z } from "zod";

const BaselineItem = z.object({
  title: z.string(),
  location: z
    .union([z.string(), z.record(z.unknown()), z.array(z.unknown())])
    .optional()
    .transform((v) => {
      if (v == null) return "";
      if (typeof v === "string") return v;
      return JSON.stringify(v);
    }),
  reasoning: z.string(),
});

const BaselineResponse = z.object({
  issues: z.array(BaselineItem),
});

export const BASELINE_SYSTEM_PROMPT =
  'Review the following Rust code for security vulnerabilities. List any issues you find. ' +
  'Reply with ONLY a JSON object, no markdown fences. ' +
  'Schema: {"issues":[{"title":"...","location":"...","reasoning":"..."}]}. ' +
  'If none, return {"issues":[]}.';

function extractJsonObject(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("no JSON object in baseline response");
    return JSON.parse(match[0]);
  }
}

export async function runBaselineOnCase(c: DatasetCase): Promise<Finding[]> {
  const files = walkRsFiles(c.program_dir);
  const source = files.map((f) => readUtf8(f)).join("\n\n");
  const text = await completeJson({
    model: baselineModel(),
    system: BASELINE_SYSTEM_PROMPT,
    user: source.slice(0, 24_000),
    requireJsonMode: false,
  });

  let parsed: unknown;
  try {
    parsed = extractJsonObject(text);
  } catch {
    return [];
  }

  const wrapped =
    parsed && typeof parsed === "object" && "issues" in (parsed as object)
      ? parsed
      : { issues: Array.isArray(parsed) ? parsed : [] };

  const { issues } = BaselineResponse.parse(wrapped);
  return issues.map((issue) => ({
    vulnerability_class: guessClass(issue.title + " " + issue.reasoning),
    instruction_name: issue.location || "unknown",
    account_name: "unknown",
    reasoning: `${issue.title}: ${issue.reasoning}`,
    confidence: "LOW" as const,
  }));
}

function guessClass(text: string): Finding["vulnerability_class"] {
  const t = text.toLowerCase();
  if (/\bsign(er|ature)?\b/.test(t)) return 1;
  if (/\bowner\b/.test(t)) return 2;
  if (/type cosplay|discriminant|discriminator|wrong type/.test(t)) return 3;
  if (/has_one|relationship|account data match/.test(t)) return 4;
  if (/\bpda\b|bump seed|canonical/.test(t)) return 5;
  return 1;
}
