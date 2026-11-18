import { afterEach, describe, expect, it } from "vitest";
import { getServerEnv, resetServerEnvCache } from "./env";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalPromptMaxChars = process.env.PROMPT_MAX_CHARS;

afterEach(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
  if (originalPromptMaxChars === undefined) {
    delete process.env.PROMPT_MAX_CHARS;
  } else {
    process.env.PROMPT_MAX_CHARS = originalPromptMaxChars;
  }
  resetServerEnvCache();
});

describe("server env", () => {
  it("defaults prompt length to the official 32000 characters", () => {
    process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:5432/test";
    delete process.env.PROMPT_MAX_CHARS;
    resetServerEnvCache();

    expect(getServerEnv().PROMPT_MAX_CHARS).toBe(32_000);
  });
});
