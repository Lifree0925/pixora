import { getServerEnv } from "../env";
import { AppError } from "../api/app-error";

function isLoopbackHostname(hostname: string): boolean {
  const value = hostname.toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === "https:" ? "443" : "80");
}

function sameLoopbackEndpoint(actual: URL, expected: URL): boolean {
  return (
    isLoopbackHostname(expected.hostname) &&
    isLoopbackHostname(actual.hostname) &&
    actual.protocol === expected.protocol &&
    effectivePort(actual) === effectivePort(expected)
  );
}

export function isAllowedOrigin(origin: string, appUrl: string): boolean {
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(origin);
    expected = new URL(appUrl);
  } catch {
    return false;
  }

  return actual.origin === expected.origin || sameLoopbackEndpoint(actual, expected);
}

export function isAllowedHost(host: string, appUrl: string): boolean {
  let actual: URL;
  let expected: URL;
  try {
    actual = new URL(`http://${host}`);
    expected = new URL(appUrl);
  } catch {
    return false;
  }

  return actual.host === expected.host || sameLoopbackEndpoint(actual, expected);
}

export function assertSameOrigin(request: Request): void {
  const env = getServerEnv();
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (origin && !isAllowedOrigin(origin, env.APP_URL)) {
    throw new AppError("FORBIDDEN", "请求来源不合法", 403);
  }

  if (host && !isAllowedHost(host, env.APP_URL)) {
    throw new AppError("FORBIDDEN", "请求 Host 不合法", 403);
  }
}
