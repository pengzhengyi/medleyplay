/**
 * @file The long files a song list was found for, read again whenever the Library may
 * have changed.
 */

import { type SplitOffers, api } from "../api";
import { useReadAgain } from "./useReadAgain";

const NONE: SplitOffers = { setting: "off", files: [] };

/** The split offers, read when `version` changes, and a way to read them again. */
export function useSplitOffers(version: unknown): {
  readonly offers: SplitOffers;
  readonly reload: () => void;
} {
  const { value, reload } = useReadAgain(api.splitOffers, NONE, version);
  return { offers: value, reload };
}
