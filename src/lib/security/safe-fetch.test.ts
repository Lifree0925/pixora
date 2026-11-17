import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./safe-fetch";

describe("safe-fetch private address detection", () => {
  it("rejects loopback, private, link-local and IPv6 internal addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.1",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "fc00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it("allows public IPv4 and IPv6 addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("2001:4860:4860::8888")).toBe(false);
  });
});
