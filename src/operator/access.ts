import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "operator";

export function operatorConfigured(): boolean {
  return Boolean(process.env.OPERATOR_PASSWORD);
}

export function passwordMatches(input: string): boolean {
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) return false;
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(password).digest();
  return timingSafeEqual(left, right);
}

export function operatorToken(): string | null {
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) return null;
  return createHmac("sha256", password).update("futureino-operator").digest("hex");
}

export async function operatorAllowed(): Promise<boolean> {
  const token = operatorToken();
  if (!token) return false;
  const jar = await cookies();
  const got = jar.get(COOKIE)?.value ?? "";
  const left = Buffer.from(got);
  const right = Buffer.from(token);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const operatorCookie = COOKIE;
