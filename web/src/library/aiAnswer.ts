/**
 * @file Naming the AI model that answered for a Track, so one provider's answer isn't
 * taken for another's, such as a local stand-in's for DeepSeek's.
 */

import type { AnsweredBy } from "../api";
import type { Words } from "../locale";

/**
 * Return the model that answered, such as `deepseek-chat`, or "the AI" when none is
 * known; `start` writes "The AI" to begin a sentence.
 */
export function aiNameOf(by: AnsweredBy | null | undefined, start = false): string {
  return by?.model ?? (start ? "The AI" : "the AI");
}

/** Say which model answered and where it was asked, or nothing when none is known. */
export function answeredOf(by: AnsweredBy | null | undefined, t?: Words): string | undefined {
  return by == null
    ? undefined
    : (t?.("Answered by {{model}} at {{host}}", { model: by.model, host: by.host }) ??
        `Answered by ${by.model} at ${by.host}`);
}
