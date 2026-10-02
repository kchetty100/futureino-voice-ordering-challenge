/**
 * Caps speech calls so a signed-in browser cannot run the OpenAI bill without a bound.
 * One process counts in memory. Redis counts across Vercel instances when it is configured.
 */

import { sharedGetCount, sharedIncr, sharedStoreConfigured } from "../persist/remote";

/** A person talking through a review stays under this. A script on one address does not. */
export const SPEECH_PER_IP_PER_HOUR = 120;
/** Site-wide cap for the UTC day, across every address. */
export const SPEECH_PER_DAY = 800;
/** Wrong passwords from one address before sign-in waits. */
export const LOGIN_FAILURES = 8;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const HOUR_TTL_SECONDS = 2 * 60 * 60;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;
const LOGIN_TTL_SECONDS = 30 * 60;

const buckets = new Map<string, { count: number; expiresAt: number }>();

export function resetSpeechBudget(): void {
  buckets.clear();
}

export function speechClientIp(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  const real = request.headers.get("x-real-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  const raw = (vercel || real || forwarded || "local").split(",")[0]?.trim() || "local";
  const cleaned = raw.replace(/[^a-zA-Z0-9.:]/g, "").slice(0, 64);
  return cleaned || "local";
}

/** True when this call may spend speech. A false result has already been counted. */
export async function claimSpeech(ip: string, now = Date.now()): Promise<boolean> {
  const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;
  const hourKey = `futureino:budget:hour:${ip}:${hourStart}`;
  const hour = await bump(hourKey, HOUR_TTL_SECONDS, hourStart + HOUR_MS, now);
  if (hour > SPEECH_PER_IP_PER_HOUR) return false;

  const day = new Date(now).toISOString().slice(0, 10);
  const dayStart = Date.parse(`${day}T00:00:00.000Z`);
  const dayKey = `futureino:budget:day:${day}`;
  const used = await bump(dayKey, DAY_TTL_SECONDS, dayStart + DAY_MS, now);
  return used <= SPEECH_PER_DAY;
}

export async function loginBlocked(ip: string, now = Date.now()): Promise<boolean> {
  const { key } = loginWindow(ip, now);
  return (await readCount(key, now)) >= LOGIN_FAILURES;
}

/** True when this wrong password locks the address for the rest of the window. */
export async function noteFailedLogin(ip: string, now = Date.now()): Promise<boolean> {
  const { key, expiresAt } = loginWindow(ip, now);
  const count = await bump(key, LOGIN_TTL_SECONDS, expiresAt, now);
  return count >= LOGIN_FAILURES;
}

export function speechBudgetDenied(): Response {
  return Response.json(
    { error: "The machine is resting its voice. Try again in a little while." },
    { status: 429 },
  );
}

function loginWindow(ip: string, now: number): { key: string; expiresAt: number } {
  const start = Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
  return { key: `futureino:budget:login:${ip}:${start}`, expiresAt: start + LOGIN_WINDOW_MS };
}

async function readCount(key: string, now: number): Promise<number> {
  if (sharedStoreConfigured()) {
    try {
      return await sharedGetCount(key);
    } catch (error) {
      console.error("Login budget store failed, counting in this process.", error instanceof Error ? error.message : "unknown error");
    }
  }
  const existing = buckets.get(key);
  if (!existing || existing.expiresAt <= now) return 0;
  return existing.count;
}

async function bump(key: string, ttlSeconds: number, expiresAt: number, now: number): Promise<number> {
  if (sharedStoreConfigured()) {
    try {
      return await sharedIncr(key, ttlSeconds);
    } catch (error) {
      console.error("Speech budget store failed, counting in this process.", error instanceof Error ? error.message : "unknown error");
    }
  }
  const existing = buckets.get(key);
  if (!existing || existing.expiresAt <= now) {
    buckets.set(key, { count: 1, expiresAt });
    return 1;
  }
  existing.count += 1;
  return existing.count;
}
