import OpenAI from "openai";

const PLACEHOLDER_KEYS = new Set([
  "",
  "gsk_...",
  "your-groq-api-key-here",
  "changeme",
  "placeholder",
]);

export function requireGroqApiKey(): string {
  const apiKey = process.env.GROQ_API_KEY?.trim() ?? "";
  if (!apiKey || PLACEHOLDER_KEYS.has(apiKey.toLowerCase()) || apiKey.startsWith("your-")) {
    throw new Error(
      [
        "GROQ_API_KEY is missing or still a placeholder.",
        "1. Open .env in the repo root.",
        "2. Set GROQ_API_KEY to a real Groq key (gsk_...) from https://console.groq.com/keys",
        "3. Re-run the command.",
      ].join("\n"),
    );
  }
  return apiKey;
}

/** @deprecated use requireGroqApiKey */
export const requireXaiApiKey = requireGroqApiKey;

export function getLlmClient(): OpenAI {
  return new OpenAI({
    apiKey: requireGroqApiKey(),
    baseURL: process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
  });
}

export function detectorModel(): string {
  return process.env.DETECTOR_MODEL ?? "openai/gpt-oss-20b";
}

export function baselineModel(): string {
  // Prefer a separate small model so baseline does not share Detector TPD.
  return process.env.BASELINE_MODEL ?? "allam-2-7b";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimit(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status: number }).status === 429;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit/i.test(msg);
}

function isRetryable(err: unknown): boolean {
  if (isRateLimit(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /connection error|ECONNRESET|ETIMEDOUT|fetch failed/i.test(msg);
}

function rateLimitWaitMs(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/try again in\s+(\d+)m([\d.]+)s/i);
  if (m) return (Number(m[1]) * 60 + Number(m[2])) * 1000 + 1000;
  const s = msg.match(/try again in\s+([\d.]+)s/i);
  if (s) return Number(s[1]) * 1000 + 1000;
  return 10_000;
}

let lastLlmCallAt = 0;
const LLM_GAP_MS = 8000;

async function throttleLlm(): Promise<void> {
  if (lastLlmCallAt > 0) {
    const wait = LLM_GAP_MS - (Date.now() - lastLlmCallAt);
    if (wait > 0) {
      process.stderr.write(`Groq throttle: waiting ${Math.ceil(wait / 1000)}s\n`);
      await sleep(wait);
    }
  }
}

export async function completeJson(options: {
  model: string;
  system: string;
  user: string;
  requireJsonMode?: boolean;
}): Promise<string> {
  requireGroqApiKey();
  await throttleLlm();
  const client = getLlmClient();
  const requireJsonMode = options.requireJsonMode !== false;
  const payload: {
    model: string;
    temperature: number;
    response_format?: { type: "json_object" };
    messages: { role: "system" | "user"; content: string }[];
  } = {
    model: options.model,
    temperature: 0,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: options.user },
    ],
  };
  if (requireJsonMode) payload.response_format = { type: "json_object" };

  const once = () =>
    client.chat.completions.create(payload, { timeout: 90_000, maxRetries: 0 });

  try {
    let resp;
    try {
      resp = await once();
    } catch (err) {
      if (!isRetryable(err)) throw err;
      const wait = isRateLimit(err) ? Math.min(rateLimitWaitMs(err), 120_000) : 10_000;
      const why = isRateLimit(err) ? "429 rate limit" : "connection error";
      process.stderr.write(
        `Groq ${why} — waiting ${Math.ceil(wait / 1000)}s and retrying once\n`,
      );
      await sleep(wait);
      resp = await once();
    }
    const text = resp.choices[0]?.message?.content;
    lastLlmCallAt = Date.now();
    if (!text) {
      if (!requireJsonMode) return '{"issues":[]}';
      throw new Error("LLM returned empty content");
    }
    return text;
  } catch (err) {
    lastLlmCallAt = Date.now();
    const msg = err instanceof Error ? err.message : String(err);
    // Groq json_object mode sometimes rejects the model output; fall back once.
    if (requireJsonMode && /Failed to validate JSON|json_object|JSON/i.test(msg)) {
      process.stderr.write("Groq JSON mode failed — retrying without response_format\n");
      return completeJson({ ...options, requireJsonMode: false });
    }
    throw new Error(`Groq API error: ${msg}`);
  }
}
