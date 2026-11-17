import "dotenv/config";
import { readFile, unlink, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { getStorage } from "../src/lib/storage";

const STATE_FILE = "/tmp/pixora-probe-assets.json";

async function prepare() {
  const storage = getStorage();
  const stamp = Date.now();
  const [a, b] = await Promise.all([
    sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } } })
      .png()
      .toBuffer(),
    sharp({ create: { width: 512, height: 512, channels: 4, background: { r: 40, g: 80, b: 220, alpha: 1 } } })
      .png()
      .toBuffer(),
  ]);

  const aKey = `checks/yijie-probe-a-${stamp}.png`;
  const bKey = `checks/yijie-probe-b-${stamp}.png`;
  await storage.upload({ key: aKey, body: new Uint8Array(a).buffer, contentType: "image/png" });
  await storage.upload({ key: bKey, body: new Uint8Array(b).buffer, contentType: "image/png" });
  const aUrl = await storage.createSignedUrl(aKey, 1800);
  const bUrl = await storage.createSignedUrl(bKey, 1800);
  await writeFile(
    STATE_FILE,
    JSON.stringify({ a: { key: aKey, url: aUrl }, b: { key: bKey, url: bUrl } }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  console.log("probe assets prepared");
  console.log(`state_file=${STATE_FILE}`);
}

async function cleanup() {
  const state = JSON.parse(await readFile(STATE_FILE, "utf8")) as {
    a?: { key?: string };
    b?: { key?: string };
  };
  const storage = getStorage();
  for (const key of [state.a?.key, state.b?.key]) {
    if (key) {
      await storage.delete(key).catch(() => undefined);
    }
  }
  await unlink(STATE_FILE).catch(() => undefined);
  console.log("probe assets cleaned");
}

async function main() {
  const command = process.argv[2] ?? "prepare";
  if (command === "cleanup") {
    await cleanup();
  } else {
    await prepare();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
