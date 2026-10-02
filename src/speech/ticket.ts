/**
 * A one-time permit to speak the line that is already on screen.
 * The order response returns as soon as the cart is known. Playback is a second call.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { isAppLanguage, type AppLanguage } from "../i18n";
import { sharedIncr, sharedStoreConfigured } from "../persist/remote";
import { lineToSpeak } from "./line";

const TTL_MS = 60_000;
const used = new Set<string>();

function secret(): string {
  return (process.env.OPERATOR_PASSWORD || "").trim();
}

export function resetSpeakTickets(): void {
  used.clear();
}

/** Null when there is nothing to say, or no server secret to sign the permit. */
export function issueSpeakTicket(
  say: string | null | undefined,
  sessionId: string | null = null,
  language: AppLanguage | null = null,
  now = Date.now(),
): string | null {
  const line = lineToSpeak(say);
  if (!line || !process.env.OPENAI_API_KEY || !secret()) return null;
  const exp = now + TTL_MS;
  const id = sessionId ?? "";
  const lang = language ?? "en";
  const mac = sign(exp, id, lang, line);
  return `${exp}.${id}.${lang}.${mac}`;
}

/** True the first time this permit is used for this exact line. */
export async function claimSpeakTicket(
  say: string,
  ticket: string,
  now = Date.now(),
): Promise<{ ok: true; sessionId: string | null; language: AppLanguage } | { ok: false }> {
  const line = lineToSpeak(say);
  if (!line || !ticket || !secret()) return { ok: false };
  const parsed = parseTicket(ticket);
  if (!parsed) return { ok: false };
  if (parsed.exp < now || parsed.exp > now + TTL_MS + 5_000) return { ok: false };
  const expected = sign(parsed.exp, parsed.sessionId ?? "", parsed.language, line);
  if (!same(parsed.mac, expected)) return { ok: false };
  const first = await takeOnce(parsed.mac);
  if (!first) return { ok: false };
  return { ok: true, sessionId: parsed.sessionId, language: parsed.language };
}

function sign(exp: number, sessionId: string, language: string, line: string): string {
  return createHmac("sha256", secret()).update(`${exp}\n${sessionId}\n${language}\n${line}`).digest("base64url");
}

function parseTicket(ticket: string): { exp: number; sessionId: string | null; language: AppLanguage; mac: string } | null {
  const parts = ticket.split(".");
  if (parts.length < 4) return null;
  const exp = Number(parts[0]);
  const mac = parts[parts.length - 1] ?? "";
  const language = parts[parts.length - 2] ?? "";
  const sessionId = parts.slice(1, -2).join(".");
  if (!Number.isFinite(exp) || !mac || !isAppLanguage(language)) return null;
  return { exp, sessionId: sessionId || null, language, mac };
}

function same(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function takeOnce(mac: string): Promise<boolean> {
  if (sharedStoreConfigured()) {
    try {
      const count = await sharedIncr(`futureino:speak:${mac}`, 70);
      return count === 1;
    } catch (error) {
      console.error("Speak permit store failed, counting in this process.", error instanceof Error ? error.message : "unknown error");
    }
  }
  if (used.has(mac)) return false;
  used.add(mac);
  return true;
}
