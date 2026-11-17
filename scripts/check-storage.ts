import "dotenv/config";
import { getStorage } from "../src/lib/storage";

const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nXQAAAAASUVORK5CYII=";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function main(): Promise<void> {
  const storage = getStorage();
  const key = `checks/storage-check-${Date.now()}.png`;
  const png = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");

  console.log(`[storage] 上传测试对象 ${key}`);
  await storage.upload({
    key,
    body: toArrayBuffer(png),
    contentType: "image/png",
  });

  try {
    const signedUrl = await storage.createSignedUrl(key, 60);
    const url = new URL(signedUrl);
    console.log(`[storage] 已生成签名 URL: host=${url.host}, path=${url.pathname}`);

    const response = await fetch(signedUrl);
    const body = new Uint8Array(await response.arrayBuffer());
    console.log(
      `[storage] GET status=${response.status}, content-type=${response.headers.get("content-type")}, bytes=${body.byteLength}`,
    );

    if (!response.ok || body.byteLength === 0) {
      throw new Error("签名 URL 读取失败或返回空内容");
    }
  } finally {
    await storage.delete(key);
    console.log(`[storage] 已删除测试对象 ${key}`);
  }

  console.log("[storage] Supabase Storage 连通性检查通过");
}

void main().catch((error: unknown) => {
  console.error("[storage] 检查失败", error instanceof Error ? error.message : error);
  process.exit(1);
});
