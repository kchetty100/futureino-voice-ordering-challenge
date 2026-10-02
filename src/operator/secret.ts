import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const operatorCookie = "operator";

export function operatorConfigured(): boolean {
  return Boolean(process.env.OPERATOR_PASSWORD);
}

export function passwordMatches(input: string): boolean {
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) return false;
  const left = createHash("sha256").update(input.trim()).digest();
  const right = createHash("sha256").update(password.trim()).digest();
  return timingSafeEqual(left, right);
}

export function operatorToken(): string | null {
  const password = process.env.OPERATOR_PASSWORD;
  if (!password) return null;
  return createHmac("sha256", password).update("futureino-operator").digest("hex");
}

export function cookieMatches(got: string): boolean {
  const token = operatorToken();
  if (!token) return false;
  const left = Buffer.from(got);
  const right = Buffer.from(token);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Only the kiosk and the operator pages may be the page after sign-in. */
export function safeNext(value: string): string {
  if (value === "/") return "/";
  if (value.startsWith("/operator") && !value.startsWith("//") && !value.includes("\\")) return value;
  return "/";
}
