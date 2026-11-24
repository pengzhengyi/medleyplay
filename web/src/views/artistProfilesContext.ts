/** @file The Library-wide artist destinations available to song and album views. */

import { createContext } from "react";

import type { ArtistProfiles } from "../library/artistProfileLinks";

export const LocalArtistProfiles = createContext<ArtistProfiles | undefined>(undefined);
