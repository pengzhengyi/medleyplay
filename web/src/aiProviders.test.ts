import { describe, expect, it } from "vitest";

import { agoOf, fixOf, isLocal, movedOrder, providerNameOf } from "./aiProviders";
import type { AiPreset, AiProvider } from "./api";

const PRESETS: readonly AiPreset[] = [
  { name: "DeepSeek", base_url: "https://api.deepseek.com", model: "deepseek-flash" },
  { name: "Ollama", base_url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
];

const NOON = Date.parse("2026-11-06T12:00:00Z");

/** A provider at `baseUrl`, with a key and no failure. */
const at = (baseUrl: string): AiProvider => ({
  id: "p1",
  base_url: baseUrl,
  model: "m",
  has_key: true,
  saved_at: "2026-11-06T09:00:00Z",
  failure: null,
  failed_at: null,
  failure_reason: null,
  failure_status: null,
});

describe("a provider's name", () => {
  it("is the name of the preset whose address it has, whatever model it asks", () => {
    expect(providerNameOf(at("https://api.deepseek.com"), PRESETS)).toBe("DeepSeek");
  });

  it("is its host, port included, when no preset has its address", () => {
    expect(providerNameOf(at("https://llm.example.com:8443/v1"), PRESETS)).toBe(
      "llm.example.com:8443",
    );
  });
});

describe("a local provider", () => {
  it.each(["http://127.0.0.1:11434/v1", "http://localhost:11434/v1", "http://[::1]:11434"])(
    "is one on this machine, such as %s",
    (baseUrl) => {
      expect(isLocal(baseUrl)).toBe(true);
    },
  );

  it("is not one elsewhere", () => {
    expect(isLocal("https://api.deepseek.com")).toBe(false);
  });
});

describe("how long ago a provider failed", () => {
  it.each([
    ["2026-11-06T11:59:30Z", "now"],
    ["2026-11-06T11:55:00Z", "5 min. ago"],
    ["2026-11-06T10:00:00Z", "2 hr. ago"],
    ["2026-11-05T11:00:00Z", "yesterday"],
    ["2026-11-01T12:00:00Z", "5 days ago"],
  ])("at %s is said as “%s” at noon", (failedAt, said) => {
    expect(agoOf(failedAt, NOON)).toBe(said);
  });
});

describe("moving a provider", () => {
  it("puts it at its new place and keeps the others in order", () => {
    expect(movedOrder(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(movedOrder(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });
});

describe("how to fix a provider's failure", () => {
  const failed = (change: Partial<AiProvider>): AiProvider => ({
    ...at("https://api.deepseek.com"),
    failure: "unusable",
    failed_at: "2026-11-06T11:00:00Z",
    ...change,
  });

  it("says what was wrong with an unusable answer", () => {
    expect(fixOf(failed({ failure_reason: "cut_off" }))).toBe(
      "Its answer ran out of room before it finished.",
    );
    expect(fixOf(failed({ failure_reason: "rejected", failure_status: 400 }))).toBe(
      "It answered 400: check the model and the base URL.",
    );
  });

  it("falls back to the failure's own advice when nothing more was kept", () => {
    expect(fixOf(failed({ failure: "refused" }))).toBe("Replace the key.");
    expect(fixOf(failed({}))).toBe("Check the model.");
  });

  it("says nothing for a provider that hasn't failed", () => {
    expect(fixOf(at("https://api.deepseek.com"))).toBe("");
  });
});
