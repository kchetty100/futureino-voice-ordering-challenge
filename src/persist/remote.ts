/**
 * Shared cart store for more than one server.
 * Upstash Redis REST, including the Vercel marketplace variable names.
 * With neither pair set, callers keep the in-process maps.
 */

const INDEX = "futureino:index";
const WEEK_SECONDS = String(7 * 24 * 60 * 60);

export function sharedStoreConfigured(): boolean {
  return Boolean(restUrl() && restToken());
}

export async function sharedGet(key: string): Promise<string | null> {
  const value = await command<string | null>("GET", key);
  return typeof value === "string" ? value : null;
}

export async function sharedGetCount(key: string): Promise<number> {
  const value = await command<unknown>("GET", key);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const count = Number(value);
    return Number.isFinite(count) ? count : 0;
  }
  return 0;
}

export async function sharedSet(key: string, value: string): Promise<void> {
  await command("SET", key, value, "EX", WEEK_SECONDS);
}

/** Add one to a counter. The first hit sets the expiry so a later hit does not extend it. */
export async function sharedIncr(key: string, ttlSeconds: number): Promise<number> {
  const count = Number(await command<number | string>("INCR", key));
  if (count === 1) await command("EXPIRE", key, String(ttlSeconds));
  return count;
}

export async function sharedRemember(id: string): Promise<void> {
  await command("SADD", INDEX, id);
}

export async function sharedIds(): Promise<string[]> {
  const ids = await command<unknown>("SMEMBERS", INDEX);
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}

export async function sharedMget(keys: string[]): Promise<Array<string | null>> {
  if (keys.length === 0) return [];
  const values = await command<unknown>("MGET", ...keys);
  if (!Array.isArray(values)) return [];
  return values.map((value) => (typeof value === "string" ? value : null));
}

async function command<T>(...args: string[]): Promise<T> {
  const url = restUrl();
  const token = restToken();
  if (!url || !token) throw new Error("Shared store is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Shared store failed (${response.status}).`);
  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) throw new Error("Shared store rejected a command.");
  return payload.result as T;
}

function restUrl(): string | null {
  const value = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim().replace(/\/$/, "");
  return value || null;
}

function restToken(): string | null {
  const value = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();
  return value || null;
}
