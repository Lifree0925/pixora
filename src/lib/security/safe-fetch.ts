import dns from "node:dns/promises";
import net from "node:net";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import { AppError } from "../api/app-error";

const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

export function isPrivateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIPv4(normalized)) {
    return isPrivateIpv4(normalized);
  }
  if (net.isIPv6(normalized)) {
    if (normalized === "::" || normalized === "::1") {
      return true;
    }
    if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80")) {
      return true;
    }
    if (normalized.startsWith("::ffff:")) {
      return isPrivateIpv4(normalized.slice("::ffff:".length));
    }
    return false;
  }
  return true;
}

export async function assertSafeRemoteUrl(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("UNSAFE_RESULT_URL", "结果 URL 格式不合法", 502);
  }

  if (url.protocol !== "https:") {
    throw new AppError("UNSAFE_RESULT_URL", "结果 URL 必须使用 HTTPS", 502);
  }
  if (url.username || url.password) {
    throw new AppError("UNSAFE_RESULT_URL", "结果 URL 不能包含认证信息", 502);
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal"
  ) {
    throw new AppError("UNSAFE_RESULT_URL", "结果 URL 指向本地或内部地址", 502);
  }

  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new AppError("UNSAFE_RESULT_URL", "结果 URL 指向私网地址", 502);
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AppError("RESULT_DOWNLOAD_FAILED", "无法解析结果 URL 域名", 502);
  }

  if (addresses.length === 0 || addresses.some((item) => isPrivateAddress(item.address))) {
    throw new AppError("UNSAFE_RESULT_URL", "结果 URL 域名解析到私网地址", 502);
  }

  return url;
}

export async function downloadRemoteImage(
  rawUrl: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; contentType: string; finalUrl: string }> {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const safeUrl = await assertSafeRemoteUrl(currentUrl);

    const proxyUrl = process.env.OUTBOUND_PROXY_URL?.trim();
    const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;

    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(safeUrl, {
        redirect: "manual",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        headers: { Accept: "image/*" },
        dispatcher,
      });
    } catch {
      throw new AppError("RESULT_DOWNLOAD_FAILED", "下载生成结果失败", 502);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AppError("RESULT_DOWNLOAD_FAILED", "结果 URL 重定向缺少 Location", 502);
      }
      currentUrl = new URL(location, safeUrl).toString();
      continue;
    }

    if (!response.ok) {
      throw new AppError("RESULT_DOWNLOAD_FAILED", `下载生成结果失败: HTTP ${response.status}`, 502);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new AppError("RESULT_DOWNLOAD_FAILED", "生成结果响应为空", 502);
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new AppError(
            "RESULT_TOO_LARGE",
            `生成结果超过 ${Math.round(maxBytes / 1024 / 1024)}MB 限制`,
            413,
          );
        }
        chunks.push(value);
      }
    }

    return {
      buffer: Buffer.concat(chunks),
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      finalUrl: safeUrl.toString(),
    };
  }

  throw new AppError("RESULT_DOWNLOAD_FAILED", "结果 URL 重定向次数过多", 502);
}
