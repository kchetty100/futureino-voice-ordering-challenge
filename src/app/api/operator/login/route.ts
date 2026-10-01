import { NextResponse } from "next/server";
import { operatorConfigured, operatorCookie, operatorToken, passwordMatches } from "../../../../operator/access";

export async function POST(request: Request) {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  if (!operatorConfigured() || !passwordMatches(password)) {
    return NextResponse.redirect(new URL("/operator?error=1", request.url), 303);
  }
  const token = operatorToken();
  const response = NextResponse.redirect(new URL("/operator", request.url), 303);
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
