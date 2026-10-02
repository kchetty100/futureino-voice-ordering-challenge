import { NextResponse } from "next/server";
import { operatorConfigured, operatorCookie, operatorToken, passwordMatches, safeNext } from "../../../../operator/access";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/operator"));
  if (!operatorConfigured() || !passwordMatches(password)) {
    const back = next.startsWith("/operator") ? "/operator?error=1" : "/enter?error=1";
    return NextResponse.redirect(new URL(back, request.url), 303);
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
