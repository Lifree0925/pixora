import { getServerEnv } from "../env";
import { SupabaseStorage } from "./supabase-storage";
import { StorageError, type StorageProvider } from "./types";

export function getStorage(): StorageProvider {
  const env = getServerEnv();

  if (env.STORAGE_DRIVER === "supabase") {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_STORAGE_BUCKET) {
      throw new StorageError(
        "STORAGE_NOT_CONFIGURED",
        "Supabase Storage 未配置，请检查 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY 和 SUPABASE_STORAGE_BUCKET",
      );
    }

    return new SupabaseStorage({
      url: env.SUPABASE_URL,
      serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_STORAGE_BUCKET,
      defaultExpiresInSeconds: env.SUPABASE_SIGNED_URL_EXPIRES_SECONDS,
    });
  }

  throw new StorageError(
    "STORAGE_DRIVER_NOT_IMPLEMENTED",
    `当前只实现了 Supabase Storage，STORAGE_DRIVER=${env.STORAGE_DRIVER} 尚未实现`,
  );
}

export { StorageError } from "./types";
export type { StorageProvider, StorageUploadInput, StorageDownloadResult } from "./types";
