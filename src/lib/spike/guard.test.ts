import { afterEach, describe, expect, it, vi } from "vitest";
import { hostnameOf, isSpikePath, spikeAllowed, spikeAllowedFor } from "./guard";

describe("isSpikePath", () => {
  it.each([
    ["/spike", true],
    ["/spike/render", true],
    ["/spike/fixture/a.pdf", true],
    ["/spiked", false],
    ["/workspace", false],
    ["/", false],
  ])("%s -> %s", (path, expected) => {
    expect(isSpikePath(path)).toBe(expected);
  });
});

describe("hostnameOf", () => {
  it.each([
    ["localhost:3020", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]:3020", "[::1]"],
    ["App.Example.com:443", "app.example.com"],
    [null, ""],
  ])("%s -> %s", (host, expected) => {
    expect(hostnameOf(host)).toBe(expected);
  });
});

describe("spikeAllowed", () => {
  it("is always on in development", () => {
    expect(spikeAllowed({ nodeEnv: "development", flag: undefined, host: "example.com" })).toBe(true);
  });

  it("is off in production by default, even on localhost", () => {
    expect(spikeAllowed({ nodeEnv: "production", flag: undefined, host: "localhost:3020" })).toBe(false);
    expect(spikeAllowed({ nodeEnv: "production", flag: "true", host: "localhost:3020" })).toBe(false);
    expect(spikeAllowed({ nodeEnv: "test", flag: undefined, host: "localhost" })).toBe(false);
  });

  it("with the explicit flag, only on loopback hosts", () => {
    expect(spikeAllowed({ nodeEnv: "production", flag: "1", host: "localhost:3020" })).toBe(true);
    expect(spikeAllowed({ nodeEnv: "production", flag: "1", host: "127.0.0.1:3020" })).toBe(true);
    expect(spikeAllowed({ nodeEnv: "production", flag: "1", host: "[::1]:3020" })).toBe(true);
    expect(spikeAllowed({ nodeEnv: "production", flag: "1", host: "plan-markup.example.com" })).toBe(false);
    expect(spikeAllowed({ nodeEnv: "production", flag: "1", host: "localhost.example.com" })).toBe(false);
    expect(spikeAllowed({ nodeEnv: "production", flag: "1", host: null })).toBe(false);
  });
});

describe("spikeAllowedFor", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads NODE_ENV and the flag from the environment", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "");
    expect(spikeAllowedFor("localhost")).toBe(false);
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "1");
    expect(spikeAllowedFor("localhost")).toBe(true);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("PLAN_MARKUP_LOCAL_SPIKE", "");
    expect(spikeAllowedFor("example.com")).toBe(true);
  });
});
