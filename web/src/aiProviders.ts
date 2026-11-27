/**
 * @file How an AI provider is named and described on its card: the preset it matches
 * or its host, whether it needs a key, and why it last failed and when.
 */

import { ApiError, type AiFailure, type AiPreset, type AiProvider } from "./api";
import type { Words } from "./locale";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** The address that names GitHub Copilot, asked with a GitHub token rather than an API key. */
const COPILOT = "https://api.githubcopilot.com";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What a failure is called on a card, and what to do about it. */
export const FAILURE_WORDS: Readonly<Record<AiFailure, { label: string; fix: string }>> = {
  unreachable: { label: "Couldn't be reached", fix: "Check the address, or that it is running." },
  busy: { label: "Too busy", fix: "The provider stayed busy. Try again later." },
  refused: { label: "Key refused", fix: "Replace the key." },
  unusable: { label: "Answer unusable", fix: "Check the model." },
  key_missing: { label: "Key missing", fix: "The Keychain no longer holds it; replace the key." },
};

/** How to fix why the provider last gave no answer, as specific as what was kept allows. */
export function fixOf(provider: AiProvider, t: Words): string {
  if (provider.failure === null) {
    return "";
  }
  switch (provider.failure_reason) {
    case "rejected":
      return provider.failure_status === null
        ? t("It answered with a refusal: check the model and the base URL.")
        : t("It answered {{status}}: check the model and the base URL.", {
            status: provider.failure_status,
          });
    case "redirected":
      return t("It answered with a redirect: check the base URL.");
    case "cut_off":
      return t("Its answer ran out of room before it finished.");
    case "empty":
      return t("Its answer was empty: check the model.");
    case "not_json":
      return t("Its answer wasn't the JSON asked for, even when asked again: try another model.");
    case null:
      return t(FAILURE_WORDS[provider.failure].fix);
  }
}

/** The name of the preset whose address the provider has, or else its host. */
export function providerNameOf(provider: AiProvider, presets: readonly AiPreset[]): string {
  const preset = presets.find((each) => each.base_url === provider.base_url);
  return preset?.name ?? hostOf(provider.base_url);
}

/** Whether the address is GitHub Copilot's, whose key is a GitHub token. */
export function isCopilot(baseUrl: string): boolean {
  return baseUrl.trim().replace(/\/+$/u, "") === COPILOT;
}

/** Whether the address is on this machine, where a provider such as Ollama needs no key. */
export function isLocal(baseUrl: string): boolean {
  return LOOPBACK.has(hostnameOf(baseUrl));
}

/** How long ago `at` was, from `now`: "now", "5 min. ago", "2 hr. ago", "yesterday". */
export function agoOf(at: string, now: number, locale: string): string {
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
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
  const dayOf = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return relative.format((dayOf(new Date(at)) - dayOf(new Date(now))) / DAY, "day");
}

const PROVIDER_REFUSALS: ReadonlyMap<number, ReadonlySet<string>> = new Map([
  [403, new Set(["Only an admin can set up the AI providers."])],
  [404, new Set(["That AI provider is no longer set up."])],
  [
    409,
    new Set([
      "The AI providers changed since they were shown; here they are now.",
      "At most 5 AI providers are kept; remove one first.",
      "That provider and model are set up already.",
    ]),
  ],
  [
    422,
    new Set([
      "The base URL is at most 256 characters.",
      "The base URL has no spaces or control characters.",
      "The base URL has no query or fragment.",
      "The base URL is like https://api.deepseek.com or http://127.0.0.1:11434/v1.",
      "The base URL has no login; the key is entered apart.",
      "The base URL is https unless it is on this machine.",
      "The model is a name of at most 128 characters.",
      "The model has no spaces or control characters.",
      "A key is from 4 to 512 characters.",
      "A key has no spaces or control characters.",
      "A provider key must contain only ASCII characters.",
    ]),
  ],
  [503, new Set(["The AI providers' keys are no longer in the Keychain; replace them."])],
]);

export function providerError(failure: unknown, fallback: string | undefined, t: Words): string {
  const detail = failure instanceof Error ? failure.message : String(failure);
  return failure instanceof ApiError && PROVIDER_REFUSALS.get(failure.status)?.has(detail)
    ? t(detail)
    : fallback === undefined
      ? detail
      : t(fallback);
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
