/**
 * @file The artists linked to MusicBrainz with no photo, read again whenever the Library may
 * have changed.
 */

import { type MissingPhoto, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: readonly MissingPhoto[] = [];

const read = async (): Promise<readonly MissingPhoto[]> => (await api.missingPhotos()).artists;

const finding = (artists: readonly MissingPhoto[]) => artists.some((each) => each.finding);

/**
 * The artists with no photo, read when `version` changes, a way to read them again, and
 * how many answers came while Deezer was asked about one.
 */
export function useMissingPhotos(version: unknown): {
  readonly artists: readonly MissingPhoto[];
  readonly reload: () => void;
  readonly answered: number;
} {
  const { value, reload, answered } = useReadAgain(read, NONE, version, finding);
  return { artists: value, reload, answered };
}
