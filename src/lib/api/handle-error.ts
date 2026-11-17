import { StorageError } from "@/lib/storage";
import { apiError } from "./error-response";
import { AppError } from "./app-error";

export function handleApiError(error: unknown, context: string) {
  if (error instanceof AppError) {
    return apiError(error.code, error.message, error.status);
  }

  if (error instanceof StorageError) {
    console.error(`[${context}] storage`, error.message);
    return apiError(error.code, "存储服务操作失败，请稍后重试", 502);
  }

  console.error(`[${context}]`, error instanceof Error ? error.message : error);
  return apiError("INTERNAL_ERROR", "服务暂时不可用，请稍后重试", 500);
}
