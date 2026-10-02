import { NextResponse } from "next/server";
import { operatorConfigured, operatorCookie, operatorToken, passwordMatches, safeNext } from "../../../../operator/access";
import { loginBlocked, noteFailedLogin, speechClientIp } from "../../../../operator/budget";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/operator"));
  const ip = speechClientIp(request);
  const reject = (code: "1" | "2") => {
    const page = next.startsWith("/operator") ? "/operator" : "/enter";
    return NextResponse.redirect(new URL(`${page}?error=${code}`, request.url), 303);
  };
  if (await loginBlocked(ip)) return reject("2");
  if (!operatorConfigured() || !passwordMatches(password)) {
    if (await noteFailedLogin(ip)) return reject("2");
    return reject("1");
  }
  const token = operatorToken();
  const response = NextResponse.redirect(new URL(next, request.url), 303);
  if (token) {
    response.cookies.set(operatorCookie, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: process.env.NODE_ENV === "production",
    });
  }
  return response;
}
