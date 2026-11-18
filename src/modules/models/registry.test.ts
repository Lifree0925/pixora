import { describe, expect, it } from "vitest";
import { getModelDefinition, listModelsForApi, ModelError } from "./registry";
import { getProviderParameterOverrides, normalizeModelParameters } from "./parameters";

const allVerified = {
  editVerified: true,
  multiImageEditVerified: true,
};

function verifyAll() {
  return allVerified;
}

describe("model registry", () => {
  it("resolves the current model and provider model ID", () => {
    const model = getModelDefinition("gr-gpt-image-2");
    expect(model.name).toBe("GPT Image 2.0");
    expect(model.provider).toBe("yijie");
    expect(model.providerModelId).toBe("gr-gpt-image-2");
  });

  it("adds GPT Image 2.5 flare and sunburst without GR aliases", () => {
    const flare = getModelDefinition("gpt-image-2.5-flare");
    const sunburst = getModelDefinition("gpt-image-2.5-sunburst");

    expect(flare.providerModelId).toBe("gpt-image-2.5-flare-优化版");
    expect(sunburst.providerModelId).toBe("gpt-image-2.5-sunburst-优化版");
    expect(flare.verificationGroup).toBe("gpt-image-2-5");
    expect(sunburst.verificationGroup).toBe("gpt-image-2-5");
  });

  it("adds Gemini Nano Banana 2.1 as a separate model", () => {
    const model = getModelDefinition("gemini-nano-banana-2.1");
    expect(model.name).toBe("Gemini Nano Banana 2.1");
    expect(model.providerModelId).toBe("gemini-nano-banana-2.1");
    expect(model.verificationGroup).toBe("gemini-nano-banana-2-1");
    expect(model.capabilities.multiImageEdit).toBe(true);
  });

  it("exposes size options as numeric aspect ratios", () => {
    expect(getModelDefinition("gr-gpt-image-2").sizes.map((size) => size.label)).toEqual([
      "1:1",
      "3:2",
      "2:3",
    ]);
    expect(getModelDefinition("gpt-image-2.5-flare").sizes.map((size) => size.label)).toEqual([
      "1:1",
      "3:2",
      "2:3",
      "1:1",
      "3:2",
      "2:3",
      "1:1",
      "3:2",
      "2:3",
    ]);
    expect(getModelDefinition("gemini-nano-banana-2.1").sizes.map((size) => size.label)).toEqual([
      "1:1",
      "3:2",
      "2:3",
      "16:9",
      "9:16",
    ]);
  });

  it("normalizes GPT Image 2 official parameters and rejects unknown fields", () => {
    const model = getModelDefinition("gr-gpt-image-2");
    expect(normalizeModelParameters({ model, size: "1024x1024", parameters: {} })).toEqual({
      size: "1024x1024",
      quality: "auto",
      background: "auto",
      output_format: "png",
      output_compression: 100,
      moderation: "auto",
    });

    expect(
      normalizeModelParameters({
        model,
        size: "1024x1024",
        parameters: { quality: "high" },
      }),
    ).toMatchObject({ quality: "high" });

    expect(() =>
      normalizeModelParameters({
        model,
        size: "1024x1024",
        parameters: { seed: 42 },
      }),
    ).toThrow(ModelError);

    expect(() =>
      normalizeModelParameters({
        model,
        size: "999x999",
        parameters: {},
      }),
    ).toThrow(ModelError);
  });

  it("only exposes 2.5 extended quality and complexity on 2.5 models", () => {
    const image2 = getModelDefinition("gr-gpt-image-2");
    const image25 = getModelDefinition("gpt-image-2.5-flare");

    expect(() =>
      normalizeModelParameters({
        model: image2,
        size: "1024x1024",
        parameters: { quality: "xhigh" },
      }),
    ).toThrow(ModelError);

    expect(
      normalizeModelParameters({
        model: image25,
        size: "2880x2880",
        parameters: { quality: "xhigh", background: "transparent" },
      }),
    ).toMatchObject({
      size: "2880x2880",
      quality: "xhigh",
      complexity: "low",
      background: "transparent",
    });
  });

  it("rejects invalid cross-field combinations", () => {
    const model = getModelDefinition("gpt-image-2.5-flare");

    expect(() =>
      normalizeModelParameters({
        model,
        size: "1024x1024",
        parameters: { background: "transparent", output_format: "jpeg" },
      }),
    ).toThrow(ModelError);

    expect(() =>
      normalizeModelParameters({
        model,
        size: "1024x1024",
        parameters: { output_format: "png", output_compression: 80 },
      }),
    ).toThrow(ModelError);
  });

  it("keeps Gemini parameters limited to the verified registry surface", () => {
    const model = getModelDefinition("gemini-nano-banana-2.1");

    expect(
      normalizeModelParameters({
        model,
        size: "1248x832",
        parameters: {},
      }),
    ).toEqual({ size: "1248x832" });

    expect(() =>
      normalizeModelParameters({
        model,
        size: "1024x1024",
        parameters: { quality: "high" },
      }),
    ).toThrow(ModelError);
  });

  it("gates each model capability group by its own verification flags", () => {
    const unverified = listModelsForApi(() => ({
      editVerified: false,
      multiImageEditVerified: false,
    }));
    const gpt25 = unverified.find((model) => model.id === "gpt-image-2.5-flare");
    expect(gpt25?.verified).toBe(false);
    expect(gpt25?.capabilities.imageEdit).toBe(false);

    const verified = listModelsForApi(verifyAll);
    const gemini = verified.find((model) => model.id === "gemini-nano-banana-2.1");
    expect(gemini?.verified).toBe(true);
    expect(gemini?.capabilities.multiImageEdit).toBe(true);
  });

  it("only sends changed non-size parameters to the provider", () => {
    const model = getModelDefinition("gpt-image-2.5-flare");
    const parameters = {
      size: "1024x1024",
      quality: "xhigh",
      complexity: "low",
      background: "transparent",
      output_format: "png",
      output_compression: 100,
      moderation: "auto",
    };

    expect(getProviderParameterOverrides(model, parameters)).toEqual({
      quality: "xhigh",
      background: "transparent",
    });
    expect(
      getProviderParameterOverrides(model, { ...parameters, complexity: "high" }),
    ).toMatchObject({ complexity: "high" });
  });
});
