import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  StorageError,
  type StorageDownloadResult,
  type StorageProvider,
  type StorageUploadInput,
} from "./types";

export class SupabaseStorage implements StorageProvider {
  private readonly client: SupabaseClient;
  private readonly bucket: string;
  private readonly defaultExpiresInSeconds: number;

  constructor(options: {
    url: string;
    serviceRoleKey: string;
    bucket: string;
    defaultExpiresInSeconds: number;
  }) {
    const normalizedUrl = options.url.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
    this.client = createClient(normalizedUrl, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = options.bucket;
    this.defaultExpiresInSeconds = options.defaultExpiresInSeconds;
  }

  async upload(input: StorageUploadInput): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).upload(input.key, input.body, {
      contentType: input.contentType,
      cacheControl: input.cacheControl ?? "3600",
      upsert: false,
    });

    if (error) {
      throw new StorageError("STORAGE_UPLOAD_FAILED", `Supabase 上传失败: ${error.message}`);
    }
  }

  async createSignedUrl(key: string, expiresInSeconds?: number): Promise<string> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, expiresInSeconds ?? this.defaultExpiresInSeconds);

    if (error || !data?.signedUrl) {
      throw new StorageError(
        "STORAGE_SIGNED_URL_FAILED",
        `Supabase 签名 URL 生成失败: ${error?.message ?? "unknown error"}`,
      );
    }

    return data.signedUrl;
  }

  async download(key: string): Promise<StorageDownloadResult> {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);

    if (error || !data) {
      throw new StorageError(
        "STORAGE_DOWNLOAD_FAILED",
        `Supabase 下载失败: ${error?.message ?? "unknown error"}`,
      );
    }

    return {
      body: await data.arrayBuffer(),
      contentType: data.type || "application/octet-stream",
    };
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([key]);

    if (error) {
      throw new StorageError("STORAGE_DELETE_FAILED", `Supabase 删除失败: ${error.message}`);
    }
  }
}
