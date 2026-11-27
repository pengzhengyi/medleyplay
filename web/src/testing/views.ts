/** @file View inputs with recorded actions and no running station. */

import { vi } from "vitest";

import { NO_FAVORITES } from "../library/favoriteGroups";
import type { TrackActions } from "../views/TrackTable";
import type { ViewProps } from "../views/Views";
import { ALICE } from "./server";

/** Track actions that record calls, with no lookup or download under way. */
export function trackActionsOf(change: Partial<TrackActions> = {}): TrackActions {
  return {
    statusOf: () => undefined,
    downloadOf: () => undefined,
    onPlay: vi.fn(),
    onPlayAll: vi.fn(),
    onPlayNext: vi.fn(),
    onAdd: vi.fn(),
    onAddToPlaylist: vi.fn(),
    onEditDetails: vi.fn(),
    canFind: () => false,
    onFind: vi.fn(),
    onEditSongs: vi.fn(),
    onAddFile: vi.fn(),
    onSetKind: vi.fn(),
    onFavorite: vi.fn(),
    onRate: vi.fn(),
    ...change,
  };
}

/** Alice's empty Library view, with no station or favorites; actions record calls. */
export function viewPropsOf(change: Partial<ViewProps> = {}): ViewProps {
  return {
    route: { view: "library" },
    tracks: [],
    playlists: [],
    playingId: undefined,
    actions: trackActionsOf(),
    admin: true,
    mode: null,
    onModeChecked: vi.fn(),
    onEnrichersChanged: vi.fn(),
    onKindsChanged: vi.fn(),
    waitingDevices: [],
    cancelDownload: vi.fn<ViewProps["cancelDownload"]>().mockResolvedValue(undefined),
    station: {
      seed: undefined,
      playing: undefined,
      start: () => false,
      startFavorites: () => false,
    },
    accountId: ALICE.id,
    favorites: NO_FAVORITES,
    onFavoriteArtist: vi.fn(),
    onFavoriteAlbum: vi.fn(),
    ...change,
  };
}
