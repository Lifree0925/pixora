import { describe, expect, it } from "vitest";
import type { ServerEnv } from "@/lib/env";
import { getModelDefinition } from "./registry";
import { getModelCapabilityVerification } from "./verification";

type VerificationEnv = Pick<
  ServerEnv,
  | "YIJIE_EDIT_VERIFIED"
  | "YIJIE_MULTI_IMAGE_EDIT_VERIFIED"
  | "YIJIE_GPT_IMAGE_2_5_EDIT_VERIFIED"
  | "YIJIE_GPT_IMAGE_2_5_MULTI_IMAGE_EDIT_VERIFIED"
  | "YIJIE_GEMINI_NANO_BANANA_2_1_EDIT_VERIFIED"
  | "YIJIE_GEMINI_NANO_BANANA_2_1_MULTI_IMAGE_EDIT_VERIFIED"
>;

const env: VerificationEnv = {
  YIJIE_EDIT_VERIFIED: true,
  YIJIE_MULTI_IMAGE_EDIT_VERIFIED: false,
  YIJIE_GPT_IMAGE_2_5_EDIT_VERIFIED: false,
  YIJIE_GPT_IMAGE_2_5_MULTI_IMAGE_EDIT_VERIFIED: true,
  YIJIE_GEMINI_NANO_BANANA_2_1_EDIT_VERIFIED: false,
  YIJIE_GEMINI_NANO_BANANA_2_1_MULTI_IMAGE_EDIT_VERIFIED: false,
};

describe("model capability verification", () => {
  it("does not leak verification flags across model groups", () => {
    expect(
      getModelCapabilityVerification(getModelDefinition("gr-gpt-image-2"), env),
    ).toEqual({ editVerified: true, multiImageEditVerified: false });

    expect(
      getModelCapabilityVerification(getModelDefinition("gpt-image-2.5-flare"), env),
    ).toEqual({ editVerified: false, multiImageEditVerified: true });

    expect(
      getModelCapabilityVerification(getModelDefinition("gemini-nano-banana-2.1"), env),
    ).toEqual({ editVerified: false, multiImageEditVerified: false });
  });
});
