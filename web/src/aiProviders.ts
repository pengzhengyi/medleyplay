/**
 * @file How an AI provider is named and described on its card: the preset it matches
 * or its host, whether it needs a key, and why it last failed and when.
 */

import type { AiFailure, AiPreset, AiProvider } from "./api";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto", style: "short" });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What a failure is called on a card, and what to do about it. */
export const FAILURE_WORDS: Readonly<Record<AiFailure, { label: string; fix: string }>> = {
  unreachable: { label: "Couldn't be reached", fix: "Check the address, or that it is running." },
  busy: { label: "Too busy", fix: "It stayed busy, so the next provider was asked." },
  refused: { label: "Key refused", fix: "Replace the key." },
  unusable: { label: "Answer unusable", fix: "Check the model." },
  key_missing: { label: "Key missing", fix: "The Keychain no longer holds it; replace the key." },
};

/** How to fix why the provider last gave no answer, as specific as what was kept allows. */
export function fixOf(provider: AiProvider): string {
  if (provider.failure === null) {
    return "";
  }
  switch (provider.failure_reason) {
    case "rejected":
      return `It answered ${String(provider.failure_status ?? "with a refusal")}: check the model and the base URL.`;
    case "redirected":
      return "It answered with a redirect: check the base URL.";
    case "cut_off":
      return "Its answer ran out of room before it finished.";
    case "empty":
      return "Its answer was empty: check the model.";
    case "not_json":
      return "Its answer wasn't the JSON asked for, even when asked again: try another model.";
    case null:
      return FAILURE_WORDS[provider.failure].fix;
  }
}

/** The name of the preset whose address the provider has, or else its host. */
export function providerNameOf(provider: AiProvider, presets: readonly AiPreset[]): string {
  const preset = presets.find((each) => each.base_url === provider.base_url);
  return preset?.name ?? hostOf(provider.base_url);
}

/** Whether the address is on this machine, where a provider such as Ollama needs no key. */
export function isLocal(baseUrl: string): boolean {
  return LOOPBACK.has(hostnameOf(baseUrl));
}

/** How long ago `at` was, from `now`: "now", "5 min. ago", "2 hr. ago", "yesterday". */
export function agoOf(at: string, now: number): string {
  const since = Math.max(now - Date.parse(at), 0);
  if (since < MINUTE) {
    return relative.format(0, "second");
  }
  if (since < HOUR) {
    return relative.format(-Math.floor(since / MINUTE), "minute");
  }
  if (since < DAY) {
    return relative.format(-Math.floor(since / HOUR), "hour");
  }
  return relative.format(-Math.floor(since / DAY), "day");
}

/** The ids with the one at `from` moved to `to`. */
export function movedOrder(ids: readonly string[], from: number, to: number): string[] {
  const order = [...ids];
  const [moved] = order.splice(from, 1);
  if (moved !== undefined) {
    order.splice(to, 0, moved);
  }
  return order;
}

function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

function hostnameOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}
