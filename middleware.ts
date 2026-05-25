import { NextResponse, type NextRequest } from "next/server";

const grossMarginAllowedPrefixes = [
  "/gross-margin",
  "/api/gross-margin",
  "/_next",
  "/favicon.ico"
];

export function middleware(request: NextRequest) {
  if (process.env.APP_MODE !== "gross-margin") {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (isAllowedGrossMarginPath(pathname)) {
    return NextResponse.next();
  }

  const target = request.nextUrl.clone();
  target.pathname = "/gross-margin";
  target.search = "";
  return NextResponse.redirect(target);
}

function isAllowedGrossMarginPath(pathname: string) {
  if (!pathname) return false;
  if (pathname === "/") return false;
  if (grossMarginAllowedPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }
  if (/\.[a-z0-9]+$/i.test(pathname)) {
    return true;
  }
  return false;
}

export const config = {
  matcher: ["/((?!api/health).*)"]
};
