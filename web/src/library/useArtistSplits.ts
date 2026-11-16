/**
 * @file The artist names written as several artists, read again whenever the Tracks change.
 */

import { type ArtistSplits, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: ArtistSplits = { offers: [], decided: [] };

/** The names to split into their artists, read when `version` changes, and a way to read them again. */
export function useArtistSplits(version: unknown): {
  readonly splits: ArtistSplits;
  readonly reload: () => void;
} {
  const { value, reload } = useReadAgain(api.artistSplits, NONE, version);
  return { splits: value, reload };
}
