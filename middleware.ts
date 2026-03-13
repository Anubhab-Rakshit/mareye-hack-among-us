import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isIpBlockedInMemory } from "@/lib/blocked-ips-memory";

function getClientIpMw(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

const honeypotDecoyPrefixes = [
  "/admin",
  "/administrator",
  "/wp-admin",
  "/wp-login.php",
  "/phpmyadmin",
  "/.git",
  "/.env",
  "/server-status",
  "/backup",
  "/api/internal",
  "/api/debug",
  "/api/admin",
];

const honeypotSensitiveFilePattern = /\.(bak|old|sql|zip|tar|gz)$/i;

function shouldRouteToHoneypot(pathname: string): boolean {
  if (
    pathname.startsWith("/api/honeypot") ||
    pathname.startsWith("/api/security/honeypot-logs")
  ) {
    return false;
  }

  const lowerPath = pathname.toLowerCase();

  if (honeypotSensitiveFilePattern.test(lowerPath)) {
    return true;
  }

  return honeypotDecoyPrefixes.some((prefix) => lowerPath.startsWith(prefix));
}

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const authToken = request.cookies.get("auth_token")?.value;
  const honeypotEnabled = process.env.HONEYPOT_ENABLED !== "false";

  // ── IP Firewall: block banned hackers ──
  const clientIp = getClientIpMw(request);
  if (
    clientIp !== "unknown" &&
    isIpBlockedInMemory(clientIp) &&
    !pathname.startsWith("/_next") &&
    !pathname.startsWith("/favicon")
  ) {
    console.log(`[FIREWALL] BLOCKED request from ${clientIp} → ${pathname}`);
    return new NextResponse(
      '<html><body style="background:#0a0a0a;color:#ff3333;font-family:monospace;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h1>⛔ ACCESS DENIED</h1><p>Your IP has been blocked by MarEye Security.</p><p style="color:#666">Incident logged. Continued access attempts will be reported.</p></div></body></html>',
      {
        status: 403,
        headers: { "content-type": "text/html; charset=utf-8" },
      },
    );
  }

  if (honeypotEnabled && shouldRouteToHoneypot(pathname)) {
    const honeypotUrl = request.nextUrl.clone();
    honeypotUrl.pathname = "/api/honeypot/trap";
    honeypotUrl.searchParams.set("target", pathname);
    return NextResponse.rewrite(honeypotUrl);
  }

  console.log(
    `[Middleware] ${pathname} | auth_token: ${authToken ? "PRESENT" : "MISSING"}`,
  );

  const protectedRoutes = [
    "/profile",
    "/security/honeypot",
    "/command-center",
    "/detection",
    "/cnn",
    "/analytics",
    "/intelligence",
    "/war-room",
    "/mission-planner",
    "/threat-prediction",
  ];
  const authPages = ["/auth/login", "/auth/register"];

  const isProtectedRoute = protectedRoutes.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  const isAuthPage = authPages.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  if (isProtectedRoute && !authToken) {
    console.log(`[Middleware] REDIRECT → /try (no auth_token for ${pathname})`);
    return NextResponse.redirect(new URL("/try", request.url));
  }

  if (isAuthPage && authToken) {
    return NextResponse.redirect(new URL("/profile", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
