import { describe, expect, it } from "vitest";
import { isAllowedHost, isAllowedOrigin } from "./origin";

describe("origin validation", () => {
  const appUrl = "http://127.0.0.1:3000";

  it("accepts both localhost and 127.0.0.1 on the local app", () => {
    expect(isAllowedOrigin("http://127.0.0.1:3000", appUrl)).toBe(true);
    expect(isAllowedOrigin("http://localhost:3000", appUrl)).toBe(true);
    expect(isAllowedHost("localhost:3000", appUrl)).toBe(true);
    expect(isAllowedHost("127.0.0.1:3000", appUrl)).toBe(true);
  });

  it("rejects other origins and ports", () => {
    expect(isAllowedOrigin("http://evil.example:3000", appUrl)).toBe(false);
    expect(isAllowedOrigin("http://localhost:3001", appUrl)).toBe(false);
    expect(isAllowedHost("evil.example:3000", appUrl)).toBe(false);
  });
});
