/**
 * Published list rates, USD per 1,000,000 tokens.
 * gpt-4o-mini: $0.15 in / $0.60 out.
 * gpt-4o-mini-transcribe: $1.25 in / $5.00 out, about $0.003 per minute.
 * gpt-4o-mini-tts: $0.60 text in / $12.00 audio out, about $0.015 per minute of speech.
 * The speech endpoint does not return a usage object, so playback is estimated.
 */

export type ModelUsage = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  audioSeconds: number;
};

const PER_MILLION: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o-mini-transcribe": { input: 1.25, output: 5 },
  "gpt-4o-mini-tts": { input: 0.6, output: 12 },
};

/** Dollars per minute when a transcribe response omits token counts. */
const TRANSCRIBE_PER_MINUTE = 0.003;
/** Audio output tokens per minute of gpt-4o-mini-tts. 1,250 × $12 / 1,000,000 = $0.015. */
const TTS_TOKENS_PER_MINUTE = 1250;
const CHARS_PER_TOKEN = 4;
const CHARS_PER_SECOND = 12.5;

export function chatUsage(
  model: string,
  payload: { usage?: { prompt_tokens?: number; completion_tokens?: number } },
): ModelUsage {
  return {
    model,
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
    audioSeconds: 0,
  };
}

export function transcribeUsage(
  payload: {
    usage?: {
      seconds?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  },
  clipSeconds = 0,
): ModelUsage {
  const usage = payload.usage;
  const seconds = typeof usage?.seconds === "number" && usage.seconds > 0 ? usage.seconds : clipSeconds;
  return {
    model: "gpt-4o-mini-transcribe",
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    audioSeconds: seconds > 0 ? roundSeconds(seconds) : 0,
  };
}

/** Estimate playback. The speech API returns audio bytes and no token usage. */
export function estimateSpeech(text: string): ModelUsage {
  const chars = text.length;
  const audioSeconds = roundSeconds(Math.max(chars / CHARS_PER_SECOND, 0.4));
  return {
    model: "gpt-4o-mini-tts",
    inputTokens: Math.ceil(chars / CHARS_PER_TOKEN),
    outputTokens: Math.round((audioSeconds * TTS_TOKENS_PER_MINUTE) / 60),
    audioSeconds,
  };
}

/** Sum of logged calls, in USD. Token counts win. Audio seconds fill in a transcribe call that omitted them. */
export function estimateUsd(events: readonly ModelUsage[]): number {
  let micro = 0;
  for (const event of events) {
    const rate = PER_MILLION[event.model];
    if (rate && (event.inputTokens > 0 || event.outputTokens > 0)) {
      micro += event.inputTokens * rate.input + event.outputTokens * rate.output;
      continue;
    }
    if (event.model === "gpt-4o-mini-transcribe" && event.audioSeconds > 0) {
      micro += (event.audioSeconds / 60) * TRANSCRIBE_PER_MINUTE * 1_000_000;
    }
  }
  return micro / 1_000_000;
}

export function formatUsd(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatSeconds(seconds: number): string {
  if (seconds <= 0) return "0s";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  return `${Math.round(seconds)}s`;
}

function roundSeconds(seconds: number): number {
  return Math.round(seconds * 10) / 10;
}
