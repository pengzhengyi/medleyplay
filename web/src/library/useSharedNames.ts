/**
 * @file The names that may name several artists, read again whenever the Tracks change.
 */

import { type SharedName, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: readonly SharedName[] = [];

const read = async (): Promise<readonly SharedName[]> => (await api.sharedNames()).names;

/** The names that may name several artists, read when `version` changes, and a way to read them again. */
export function useSharedNames(version: unknown): {
  readonly names: readonly SharedName[];
  readonly reload: () => void;
} {
  const { value, reload } = useReadAgain(read, NONE, version);
  return { names: value, reload };
}
