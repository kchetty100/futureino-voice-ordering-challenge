import { NextResponse } from "next/server";
import { operatorCookie } from "../../../../operator/access";

export async function POST(request: Request) {
  const response = NextResponse.redirect(new URL("/enter", request.url), 303);
  response.cookies.set(operatorCookie, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
