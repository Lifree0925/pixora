import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "../api/app-error";
import { prisma } from "../db/prisma";
import { getServerEnv } from "../env";
import { getStorage } from "./index";
import { StorageError } from "./types";

const ALLOWED_OUTPUT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export interface StoredGeneratedImage {
  id: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  sha256: string;
  previewUrl: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function storeGeneratedImage(buffer: Buffer): Promise<StoredGeneratedImage> {
  const env = getServerEnv();
  if (buffer.byteLength === 0) {
    throw new AppError("PROVIDER_NO_RESULT", "生成结果为空", 502);
  }
  if (buffer.byteLength > env.MAX_RESULT_MB * 1024 * 1024) {
    throw new AppError("RESULT_TOO_LARGE", "生成结果超过大小限制", 413);
  }

  let detected;
  try {
    detected = await fileTypeFromBuffer(buffer);
  } catch {
    detected = undefined;
  }
  if (!detected || !ALLOWED_OUTPUT_MIME_TYPES.has(detected.mime)) {
    throw new AppError("PROVIDER_NO_RESULT", "生成结果不是支持的图片格式", 502);
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new AppError("PROVIDER_NO_RESULT", "生成结果无法解码", 502);
  }
  if (!metadata.width || !metadata.height) {
    throw new AppError("PROVIDER_NO_RESULT", "生成结果缺少尺寸信息", 502);
  }
  if (metadata.width * metadata.height > env.MAX_IMAGE_PIXELS) {
    throw new AppError("RESULT_TOO_LARGE", "生成结果像素数超过限制", 413);
  }

  const assetId = randomUUID();
  const extension = detected.ext ?? (detected.mime === "image/jpeg" ? "jpg" : "png");
  const storageKey = `outputs/${assetId}/${randomUUID()}.${extension}`;
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const storage = getStorage();

  try {
    await storage.upload({
      key: storageKey,
      body: toArrayBuffer(buffer),
      contentType: detected.mime,
    });
  } catch (error) {
    if (error instanceof StorageError) {
      throw new AppError("STORAGE_UPLOAD_FAILED", "生成结果保存到存储失败", 502);
    }
    throw error;
  }

  try {
    const asset = await prisma.imageAsset.create({
      data: {
        id: assetId,
        storageKey,
        mimeType: detected.mime,
        sizeBytes: buffer.byteLength,
        width: metadata.width,
        height: metadata.height,
        sha256,
        origin: "generated",
      },
    });

    return {
      id: asset.id,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
      previewUrl: `/api/assets/${asset.id}/content`,
    };
  } catch {
    await storage.delete(storageKey).catch(() => undefined);
    throw new AppError("INTERNAL_ERROR", "生成结果元数据保存失败", 500);
  }
}
