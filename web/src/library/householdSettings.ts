/**
 * @file Save one part of the household's settings without undoing another part.
 *
 * The settings are one document with one revision, and each Settings section saves its
 * own field of it. When another save came first, the section's change is laid over the
 * settings as they are now and saved again, unless that other save changed the same field.
 */

import { ApiError, type Settings, api } from "../api";

/** What a section says when someone else changed its field first. */
export const CHANGED_ELSEWHERE = "Someone else changed this first, so here it is now.";

/** What a section says when its change couldn't be saved; it is tried again. */
export function notSaved(failure: unknown): string {
  return `Not saved: ${failure instanceof Error ? failure.message : String(failure)}`;
}

/** A change to some of the household's settings. */
export type SettingsChange = Partial<Omit<Settings, "revision">>;

/** How saving a change went, and the settings as the server now has them. */
export interface Saved {
  /** `conflict` when someone else changed a field of the change first. */
  readonly outcome: "saved" | "conflict";
  readonly settings: Settings;
}

/** Save `change` over `held`; when another save came first, over the settings now. */
export async function saveChange(held: Settings, change: SettingsChange): Promise<Saved> {
  const saved = await saveOver(held, change);
  if (saved !== undefined) {
    return { outcome: "saved", settings: saved };
  }
  const now = await api.settings();
  const fields = Object.keys(change) as (keyof SettingsChange)[];
  // A field may be a list, read anew each time, so fields are compared by value.
  if (fields.some((field) => JSON.stringify(now[field]) !== JSON.stringify(held[field]))) {
    return { outcome: "conflict", settings: now };
  }
  const again = await saveOver(now, change);
  return again === undefined
    ? { outcome: "conflict", settings: await api.settings() }
    : { outcome: "saved", settings: again };
}

/** Save `change` over `held`, or return `undefined` when another save came first. */
async function saveOver(held: Settings, change: SettingsChange): Promise<Settings | undefined> {
  try {
    return await api.saveSettings({ ...held, ...change });
  } catch (failure) {
    if (failure instanceof ApiError && failure.status === 409) {
      return undefined;
    }
    throw failure;
  }
}
