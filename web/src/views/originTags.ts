/** @file Each origin's mark and short name, as its tag shows them. */

import {
  FileAudioIcon,
  FileIcon,
  type Icon,
  PencilSimpleIcon,
  SparkleIcon,
  TagIcon,
  TelevisionSimpleIcon,
  VinylRecordIcon,
} from "@phosphor-icons/react";

import type { Origin } from "../api";

/** Each origin's mark and short name. */
export const ORIGIN_TAGS: Readonly<
  Record<Origin, { readonly short: string; readonly icon: Icon }>
> = {
  household: { short: "Yours", icon: PencilSimpleIcon },
  files: { short: "Tags", icon: TagIcon },
  musicbrainz: { short: "MB", icon: VinylRecordIcon },
  video: { short: "BV", icon: TelevisionSimpleIcon },
  album_file: { short: "Album file", icon: FileAudioIcon },
  file_name: { short: "File name", icon: FileIcon },
  ai: { short: "AI", icon: SparkleIcon },
};
