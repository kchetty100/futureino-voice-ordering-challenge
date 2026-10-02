import { NextResponse, type NextRequest } from "next/server";
import { cookieMatches, operatorConfigured, operatorCookie, safeNext } from "./operator/secret";

export function proxy(request: NextRequest) {
  if (operatorConfigured() && cookieMatches(request.cookies.get(operatorCookie)?.value ?? "")) {
    return NextResponse.next();
  }
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/enter";
  url.search = "";
  const next = safeNext(pathname);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|enter|api/operator/login).*)"],
};
