/**
 * @file The artists linked to MusicBrainz with no photo, read again whenever the Tracks change.
 */

import { type MissingPhoto, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: readonly MissingPhoto[] = [];

const read = async (): Promise<readonly MissingPhoto[]> => (await api.missingPhotos()).artists;

/** The artists with no photo, read when `version` changes, and a way to read them again. */
export function useMissingPhotos(version: unknown): {
  readonly artists: readonly MissingPhoto[];
  readonly reload: () => void;
} {
  const { value, reload } = useReadAgain(read, NONE, version);
  return { artists: value, reload };
}
