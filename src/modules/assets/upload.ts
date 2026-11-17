import { createHash, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { AppError } from "@/lib/api/app-error";
import { prisma } from "@/lib/db/prisma";
import { getServerEnv } from "@/lib/env";
import { getStorage, StorageError } from "@/lib/storage";

const ALLOWED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export class AssetUploadError extends AppError {
  constructor(code: string, message: string, status = 400) {
    super(code, message, status);
    this.name = "AssetUploadError";
  }
}

export interface UploadedAssetDto {
  id: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  previewUrl: string;
}

export interface GeneratedAssetDto extends UploadedAssetDto {
  sha256: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function uploadReferenceImage(file: File): Promise<UploadedAssetDto> {
  const env = getServerEnv();

  if (file.size <= 0) {
    throw new AssetUploadError("VALIDATION_ERROR", "上传文件不能为空");
  }

  if (file.size > env.MAX_UPLOAD_MB * 1024 * 1024) {
    throw new AssetUploadError("UPLOAD_TOO_LARGE", `图片不能超过 ${env.MAX_UPLOAD_MB}MB`, 413);
  }

  const input = Buffer.from(await file.arrayBuffer());

  let detected;
  try {
    detected = await fileTypeFromBuffer(input);
  } catch {
    throw new AssetUploadError("UNSUPPORTED_MEDIA_TYPE", "无法识别图片格式");
  }

  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new AssetUploadError(
      "UNSUPPORTED_MEDIA_TYPE",
      "仅支持 PNG、JPEG、WebP 图片；不支持 SVG、GIF、HEIC",
      415,
    );
  }

  let metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw new AssetUploadError("IMAGE_DECODE_FAILED", "图片解码失败，请换一张图片");
  }

  if (!metadata.width || !metadata.height) {
    throw new AssetUploadError("IMAGE_DECODE_FAILED", "无法读取图片尺寸");
  }

  if (metadata.width * metadata.height > env.MAX_IMAGE_PIXELS) {
    throw new AssetUploadError("UPLOAD_TOO_LARGE", "图片像素数超过限制", 413);
  }

  const preserveAlpha = Boolean(metadata.hasAlpha) || detected.mime === "image/png";
  const normalized = preserveAlpha
    ? await sharp(input).rotate().png({ compressionLevel: 9 }).toBuffer()
    : await sharp(input).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();

  if (normalized.byteLength > env.MAX_UPLOAD_MB * 1024 * 1024) {
    throw new AssetUploadError("UPLOAD_TOO_LARGE", "规范化后的图片超过大小限制", 413);
  }

  const normalizedMetadata = await sharp(normalized).metadata();
  const mimeType = preserveAlpha ? "image/png" : "image/jpeg";
  const extension = preserveAlpha ? "png" : "jpg";
  const assetId = randomUUID();
  const storageKey = `inputs/${assetId}/${randomUUID()}.${extension}`;
  const sha256 = createHash("sha256").update(normalized).digest("hex");
  const storage = getStorage();

  try {
    await storage.upload({
      key: storageKey,
      body: toArrayBuffer(normalized),
      contentType: mimeType,
    });
  } catch (error) {
    if (error instanceof StorageError) {
      throw new AssetUploadError("STORAGE_UPLOAD_FAILED", "参考图上传到对象存储失败", 502);
    }
    throw error;
  }

  try {
    const asset = await prisma.imageAsset.create({
      data: {
        id: assetId,
        storageKey,
        mimeType,
        sizeBytes: normalized.byteLength,
        width: normalizedMetadata.width ?? metadata.width,
        height: normalizedMetadata.height ?? metadata.height,
        sha256,
        origin: "uploaded",
      },
    });

    return {
      id: asset.id,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      width: asset.width,
      height: asset.height,
      previewUrl: `/api/assets/${asset.id}/content`,
    };
  } catch {
    await storage.delete(storageKey).catch(() => undefined);
    throw new AssetUploadError("INTERNAL_ERROR", "资产元数据保存失败", 500);
  }
}

async function inspectImageBuffer(buffer: Buffer, maxBytes: number) {
  const env = getServerEnv();

  if (buffer.byteLength <= 0) {
    throw new AssetUploadError("VALIDATION_ERROR", "图片内容为空");
  }
  if (buffer.byteLength > maxBytes) {
    throw new AssetUploadError("UPLOAD_TOO_LARGE", "图片文件超过大小限制", 413);
  }

  let detected;
  try {
    detected = await fileTypeFromBuffer(buffer);
  } catch {
    throw new AssetUploadError("UNSUPPORTED_MEDIA_TYPE", "无法识别图片格式");
  }

  if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
    throw new AssetUploadError(
      "UNSUPPORTED_MEDIA_TYPE",
      "仅支持 PNG、JPEG、WebP 图片；不支持 SVG、GIF、HEIC",
      415,
    );
  }

  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new AssetUploadError("IMAGE_DECODE_FAILED", "图片解码失败");
  }

  if (!metadata.width || !metadata.height) {
    throw new AssetUploadError("IMAGE_DECODE_FAILED", "无法读取图片尺寸");
  }
  if (metadata.width * metadata.height > env.MAX_IMAGE_PIXELS) {
    throw new AssetUploadError("UPLOAD_TOO_LARGE", "图片像素数超过限制", 413);
  }

  return { detected, metadata };
}

export async function getAssetRecord(assetId: string) {
  const asset = await prisma.imageAsset.findFirst({
    where: { id: assetId, deletedAt: null },
  });

  if (!asset) {
    throw new AssetUploadError("ASSET_NOT_FOUND", "资产不存在", 404);
  }

  return asset;
}

export async function getAssetContent(assetId: string) {
  const asset = await getAssetRecord(assetId);
  const storage = getStorage();
  const object = await storage.download(asset.storageKey);

  return { asset, object };
}

export async function getAssetSignedUrl(assetId: string, expiresInSeconds?: number): Promise<string> {
  const asset = await getAssetRecord(assetId);
  const storage = getStorage();
  return storage.createSignedUrl(asset.storageKey, expiresInSeconds);
}

export async function storeGeneratedImage(input: {
  buffer: Buffer;
  sourceContentType?: string;
}): Promise<GeneratedAssetDto> {
  const env = getServerEnv();
  const maxBytes = env.MAX_RESULT_MB * 1024 * 1024;
  const { detected, metadata } = await inspectImageBuffer(input.buffer, maxBytes);
  const assetId = randomUUID();
  const extension = detected.ext ?? (detected.mime === "image/jpeg" ? "jpg" : "png");
  const storageKey = `outputs/${assetId}/${randomUUID()}.${extension}`;
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const storage = getStorage();

  try {
    await storage.upload({
      key: storageKey,
      body: toArrayBuffer(input.buffer),
      contentType: detected.mime,
    });
  } catch (error) {
    if (error instanceof StorageError) {
      throw new AssetUploadError("STORAGE_UPLOAD_FAILED", "生成结果保存到存储失败", 502);
    }
    throw error;
  }

  try {
    const asset = await prisma.imageAsset.create({
      data: {
        id: assetId,
        storageKey,
        mimeType: detected.mime,
        sizeBytes: input.buffer.byteLength,
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
    throw new AssetUploadError("INTERNAL_ERROR", "生成结果元数据保存失败", 500);
  }
}
