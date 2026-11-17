/**
 * @file The artist and album names written with more than the name in them, to tidy.
 *
 * They are read again whenever `version` changes, as it does with the Tracks, and after
 * a change made here; nothing is read while `version` is `undefined`.
 */

import { type NameToTidy, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: { names: NameToTidy[] } = { names: [] };

/** The names to tidy, and a way to read them again after tidying or keeping one. */
export function useNamesToTidy(version: unknown): {
  readonly names: readonly NameToTidy[];
  readonly reload: () => void;
} {
  const { value, reload } = useReadAgain(api.namesToTidy, NONE, version);
  return { names: value.names, reload };
}
