import { cookies } from "next/headers";
import { cookieMatches, operatorCookie } from "./secret";

export { cookieMatches, operatorConfigured, operatorCookie, operatorToken, passwordMatches, safeNext } from "./secret";

export async function operatorAllowed(): Promise<boolean> {
  const jar = await cookies();
  return cookieMatches(jar.get(operatorCookie)?.value ?? "");
}
