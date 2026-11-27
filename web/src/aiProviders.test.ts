import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { agoOf, fixOf, isCopilot, isLocal, movedOrder, providerNameOf } from "./aiProviders";
import type { AiPreset, AiProvider } from "./api";
import { useWords } from "./locale";
import { aiProviderOf } from "./testing/server";

const PRESETS: readonly AiPreset[] = [
  { name: "DeepSeek", base_url: "https://api.deepseek.com", model: "deepseek-flash" },
  { name: "Ollama", base_url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
];

const NOON = Date.parse("2026-11-06T12:00:00");

/** A provider at `baseUrl`, with a key and no failure. */
const at = (baseUrl: string): AiProvider =>
  aiProviderOf({ id: "p1", base_url: baseUrl, model: "m", saved_at: "2026-11-06T09:00:00Z" });

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

describe("GitHub Copilot", () => {
  it("is the provider at Copilot's address, with or without a trailing slash", () => {
    expect(
      [
        "https://api.githubcopilot.com",
        " https://api.githubcopilot.com/ ",
        "https://api.openai.com/v1",
      ].map(isCopilot),
    ).toEqual([true, true, false]);
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
    ["2026-11-06T11:59:30", "now"],
    ["2026-11-06T11:55:00", "5 min. ago"],
    ["2026-11-06T10:00:00", "2 hr. ago"],
    ["2026-11-05T11:00:00", "yesterday"],
    ["2026-11-01T12:00:00", "5 days ago"],
  ])("at %s is said as “%s” at noon", (failedAt, said) => {
    expect(agoOf(failedAt, NOON, "en-US")).toBe(said);
  });

  it("uses the local calendar day when a failure crossed two midnights", () => {
    const saturday = new Date(2026, 10, 7, 23, 59);
    const monday = new Date(2026, 10, 9, 0, 1);

    expect(agoOf(saturday.toISOString(), monday.getTime(), "en-US")).toBe("2 days ago");
    expect(agoOf(saturday.toISOString(), monday.getTime(), "zh-Hans")).toBe("前天");
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
    const t = renderHook(useWords).result.current;
    expect(fixOf(failed({ failure_reason: "cut_off" }), t)).toBe(
      "Its answer ran out of room before it finished.",
    );
    expect(fixOf(failed({ failure_reason: "rejected", failure_status: 400 }), t)).toBe(
      "It answered 400: check the model and the base URL.",
    );
  });

  it("falls back to the failure's own advice when nothing more was kept", () => {
    const t = renderHook(useWords).result.current;
    expect(fixOf(failed({ failure: "refused" }), t)).toBe("Replace the key.");
    expect(fixOf(failed({}), t)).toBe("Check the model.");
  });

  it("does not claim that any other provider was asked when this one stayed busy", () => {
    const t = renderHook(useWords).result.current;

    expect(fixOf(failed({ failure: "busy" }), t)).toBe(
      "The provider stayed busy. Try again later.",
    );
  });

  it("says nothing for a provider that hasn't failed", () => {
    const t = renderHook(useWords).result.current;
    expect(fixOf(at("https://api.deepseek.com"), t)).toBe("");
  });
});
