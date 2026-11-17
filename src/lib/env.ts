import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://127.0.0.1:3000"),
  APP_BIND_HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL 不能为空"),

  STORAGE_DRIVER: z.enum(["supabase", "s3", "local"]).default("supabase"),
  SUPABASE_URL: z.string().default(""),
  SUPABASE_SERVICE_ROLE_KEY: z.string().default(""),
  SUPABASE_STORAGE_BUCKET: z.string().default(""),
  SUPABASE_SIGNED_URL_EXPIRES_SECONDS: z.coerce.number().int().positive().default(3600),

  YIJIE_BASE_URL: z.url().default("https://yijieapi.com"),
  YIJIE_API_KEY: z.string().default(""),
  YIJIE_MODEL: z.string().default("gr-gpt-image-2"),
  YIJIE_EDIT_VERIFIED: booleanString,
  YIJIE_MULTI_IMAGE_EDIT_VERIFIED: booleanString,
  YIJIE_GPT_IMAGE_2_5_EDIT_VERIFIED: booleanString,
  YIJIE_GPT_IMAGE_2_5_MULTI_IMAGE_EDIT_VERIFIED: booleanString,
  YIJIE_GEMINI_NANO_BANANA_2_1_EDIT_VERIFIED: booleanString,
  YIJIE_GEMINI_NANO_BANANA_2_1_MULTI_IMAGE_EDIT_VERIFIED: booleanString,

  S3_ENDPOINT: z.string().default(""),
  S3_PUBLIC_ENDPOINT: z.string().default(""),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().default(""),
  S3_ACCESS_KEY_ID: z.string().default(""),
  S3_SECRET_ACCESS_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: booleanString,
  S3_PRESIGN_EXPIRES_SECONDS: z.coerce.number().int().positive().default(3600),

  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(20),
  MAX_TOTAL_UPLOAD_MB: z.coerce.number().int().positive().default(80),
  MAX_REFERENCE_IMAGES: z.coerce.number().int().positive().default(8),
  MAX_IMAGE_PIXELS: z.coerce.number().int().positive().default(40_000_000),
  MAX_RESULT_MB: z.coerce.number().int().positive().default(50),
  PROMPT_MAX_CHARS: z.coerce.number().int().positive().default(8000),

  TASK_POLL_MAX_SECONDS: z.coerce.number().int().positive().default(900),
  TASK_POLL_MIN_SECONDS: z.coerce.number().int().positive().default(2),
  TASK_POLL_MAX_INTERVAL_SECONDS: z.coerce.number().int().positive().default(30),
  TASK_LEASE_SECONDS: z.coerce.number().int().positive().default(60),
  TASK_QUERY_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(30),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),

  OUTBOUND_PROXY_URL: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cachedEnv: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`环境变量校验失败: ${details}`);
  }

  cachedEnv = result.data;
  return cachedEnv;
}

export function resetServerEnvCache(): void {
  cachedEnv = null;
}

export function isYijieConfigured(env: ServerEnv = getServerEnv()): boolean {
  return env.YIJIE_API_KEY.trim().length > 0;
}

export function isStorageConfigured(env: ServerEnv = getServerEnv()): boolean {
  if (env.STORAGE_DRIVER === "supabase") {
    return Boolean(
      env.SUPABASE_URL &&
        env.SUPABASE_SERVICE_ROLE_KEY &&
        env.SUPABASE_STORAGE_BUCKET,
    );
  }

  if (env.STORAGE_DRIVER === "s3") {
    return Boolean(
      env.S3_ENDPOINT &&
        env.S3_BUCKET &&
        env.S3_ACCESS_KEY_ID &&
        env.S3_SECRET_ACCESS_KEY,
    );
  }

  return false;
}
