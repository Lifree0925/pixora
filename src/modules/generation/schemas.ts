import { z } from "zod";

export const generationModeSchema = z.enum([
  "text_to_image",
  "image_edit",
  "multi_image_edit",
]);

export const imageSizeSchema = z.string().min(1);

export const modelParameterSchema = z.union([z.string(), z.number(), z.boolean()]);

export const createTaskSchema = z.object({
  mode: generationModeSchema,
  prompt: z.string().trim().min(1, "提示词不能为空"),
  modelId: z.string().min(1).optional(),
  size: imageSizeSchema,
  parameters: z.record(z.string(), modelParameterSchema).default({}),
  assetIds: z.array(z.string().min(1)).default([]),
  parentTaskId: z.string().min(1).nullable().optional(),
  parentAssetId: z.string().min(1).nullable().optional(),
});

export type CreateTaskRequest = z.infer<typeof createTaskSchema>;

export const historyEditSchema = z.object({
  prompt: z.string().trim().min(1, "提示词不能为空"),
  size: imageSizeSchema,
});

export type HistoryEditRequest = z.infer<typeof historyEditSchema>;

export const idempotencyKeySchema = z.string().uuid("Idempotency-Key 必须是 UUID");
export const taskIdSchema = z.string().min(1);
