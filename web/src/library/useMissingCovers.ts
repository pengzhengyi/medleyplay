/**
 * @file The albums with no cover, read again whenever the Library may have changed.
 */

import { type MissingCover, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: readonly MissingCover[] = [];

const read = async (): Promise<readonly MissingCover[]> => (await api.missingCovers()).albums;

const finding = (albums: readonly MissingCover[]) => albums.some((each) => each.finding);

/**
 * The albums with no cover, read when `version` changes, a way to read them again, and how
 * many answers came while MusicBrainz was searched for one.
 */
export function useMissingCovers(version: unknown): {
  readonly albums: readonly MissingCover[];
  readonly reload: () => void;
  readonly answered: number;
} {
  const { value, reload, answered } = useReadAgain(read, NONE, version, finding);
  return { albums: value, reload, answered };
}
