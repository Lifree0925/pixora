import type { ServerEnv } from "@/lib/env";
import type { ModelDefinition, ModelVerification } from "./registry";

type VerificationEnv = Pick<
  ServerEnv,
  | "YIJIE_EDIT_VERIFIED"
  | "YIJIE_MULTI_IMAGE_EDIT_VERIFIED"
  | "YIJIE_GPT_IMAGE_2_5_EDIT_VERIFIED"
  | "YIJIE_GPT_IMAGE_2_5_MULTI_IMAGE_EDIT_VERIFIED"
  | "YIJIE_GEMINI_NANO_BANANA_2_1_EDIT_VERIFIED"
  | "YIJIE_GEMINI_NANO_BANANA_2_1_MULTI_IMAGE_EDIT_VERIFIED"
>;

export function getModelCapabilityVerification(
  model: Pick<ModelDefinition, "verificationGroup">,
  env: VerificationEnv,
): ModelVerification {
  switch (model.verificationGroup) {
    case "gpt-image-2-5":
      return {
        editVerified: env.YIJIE_GPT_IMAGE_2_5_EDIT_VERIFIED,
        multiImageEditVerified: env.YIJIE_GPT_IMAGE_2_5_MULTI_IMAGE_EDIT_VERIFIED,
      };
    case "gemini-nano-banana-2-1":
      return {
        editVerified: env.YIJIE_GEMINI_NANO_BANANA_2_1_EDIT_VERIFIED,
        multiImageEditVerified: env.YIJIE_GEMINI_NANO_BANANA_2_1_MULTI_IMAGE_EDIT_VERIFIED,
      };
    case "gpt-image-2":
    default:
      return {
        editVerified: env.YIJIE_EDIT_VERIFIED,
        multiImageEditVerified: env.YIJIE_MULTI_IMAGE_EDIT_VERIFIED,
      };
  }
}
