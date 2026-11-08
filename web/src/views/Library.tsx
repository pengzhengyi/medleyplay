/**
 * @file The signed-in page: the views, the search, the queue, and the player.
 */

import {
  CloudSlashIcon,
  DeviceMobileSpeakerIcon,
  KeyboardIcon,
  SignOutIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AI_ENRICHER, type Account, type Kind, type Track, api } from "../api";
import { LOOKUPS, type Lookup, coverStatusOf } from "../library/lookups";
import { useLibrary } from "../library/useLibrary";
import { useLookAhead } from "../library/useLookAhead";
import { useStation } from "../library/useStation";
import { current, repeatAfter, upNext } from "../player/queue";
import { checkable, offlineBecause } from "../mode";
import { usePlayer } from "../player/usePlayer";
import { takeOf } from "../player/remote";
import { useRemotePlayer } from "../player/useRemotePlayer";
import { useSleepTimer } from "../player/useSleepTimer";
import { useSpeaker } from "../player/useSpeaker";
import { stepVolume } from "../player/volume";
import { hrefOf, useRoute } from "../routes";
import { hintOf, learnLayout, openAccount, useBindings } from "../shortcuts";
import { AddFile } from "./AddFile";
import { AddLink } from "./AddLink";
import { AddToPlaylist } from "./AddToPlaylist";
import { CheckNetwork } from "./CheckNetwork";
import { EditDetails } from "./EditDetails";
import { ListenOnDevice } from "./ListenOnDevice";
import { type AiAsk, SongsEditor } from "./EditSongs";
import { Nav } from "./Nav";
import { NowPlaying } from "./NowPlaying";
import { PlayOn, type PlaysOn } from "./PlayOn";
import { PlayerBar } from "./PlayerBar";
import { QueuePanel } from "./QueuePanel";
import { SearchBox } from "./SearchBox";
import { ShortcutList } from "./ShortcutList";
import { type ShortcutHandlers, Shortcuts } from "./Shortcuts";
import { REPEATS, shuffleSaid } from "./playModes";
import { ThemeSwitch } from "./ThemeSwitch";
import { WaitingDevices } from "./WaitingDevices";
import type { TrackActions } from "./TrackTable";
import { CurrentView } from "./Views";

/** How long a notice, such as a song added to a Playlist, stays. */
const NOTICE_MS = 4000;
/** How far a shortcut seeks back or ahead, as the arrows do on the position. */
const SEEK_SECONDS = 5;
/** Where the queue can close, as the page's styles have it; wider, it is always open. */
const NARROW = "(width <= 64rem)";
const listFormat = new Intl.ListFormat(undefined, { type: "conjunction" });

/** Everything a signed-in Account sees. */
export function Library({
  account,
  onHost,
  onSignedOut,
}: {
  readonly account: Account;
  /** Whether this page is on the computer medleyplay runs on, and so plays for the Account. */
  readonly onHost: boolean;
  readonly onSignedOut: () => void;
}) {
  const route = useRoute();
  const library = useLibrary(onSignedOut);
  const byId = library.tracks;
  const tracks = useMemo(() => [...byId.values()], [byId]);
  // The artists a typed song list offers, each once.
  const artists = useMemo(
    () => [...new Set(tracks.map((track) => track.artist.trim()).filter((name) => name !== ""))],
    [tracks],
  );
  const [local, audio] = usePlayer(byId, onSignedOut);
  const localSleep = useSleepTimer(local.pause);
  useSpeaker(onHost, local, localSleep, byId, library.speaker, library.onCommand);
  // Where a page that isn't on the computer plays; with the computer gone, it plays here.
  const [playsOn, setPlaysOn] = useState<PlaysOn>("here");
  const [playOnFailed, setPlayOnFailed] = useState("");
  const speaker = library.speaker ?? null;
  const canPlayOnComputer = !onHost && speaker !== null;
  if (playsOn === "computer" && !canPlayOnComputer) {
    setPlaysOn("here");
  }
  const onComputer = playsOn === "computer" && canPlayOnComputer;
  const [remote, remoteSleep, command] = useRemotePlayer(speaker, onComputer, onSignedOut);
  const player = onComputer ? remote : local;
  const sleep = onComputer ? remoteSleep : localSleep;
  const playOnFailedFor = (failure: unknown) => {
    setPlayOnFailed(failure instanceof Error ? failure.message : String(failure));
  };
  /**
   * Play on `where`, moving what plays there, as Spotify Connect does. The device the
   * music leaves stops only once the computer has the command, so a refusal leaves
   * the music where it was.
   */
  const playOn = (where: PlaysOn) => {
    setPlayOnFailed("");
    if (where === playsOn) {
      return;
    }
    if (where === "here") {
      const handoff = remote.status.kind === "playing" ? remote.handoff() : undefined;
      if (handoff === undefined) {
        setPlaysOn("here");
        return;
      }
      command({ kind: "pause" }).then(() => {
        local.take(handoff, true);
        setPlaysOn("here");
      }, playOnFailedFor);
      return;
    }
    const handoff = local.status.kind === "playing" ? local.handoff() : undefined;
    if (handoff === undefined) {
      setPlaysOn("computer");
      return;
    }
    command(takeOf(handoff, true)).then(() => {
      local.pause();
      setPlaysOn("computer");
    }, playOnFailedFor);
  };
  const station = useStation(player, tracks, account.id, library.favoriteGroups);
  // On a narrow screen the queue opens over the page, from the player.
  const [queueOpen, setQueueOpen] = useState(false);
  // When the Mode a check left Offline began, so the header says it is still Offline.
  const [stillSince, setStillSince] = useState<string | null>(null);
  // The view Now Playing was opened over, while it is open; going to another view closes it.
  const here = hrefOf(route);
  const [nowPlayingOver, setNowPlayingOver] = useState<string | undefined>(undefined);
  if (nowPlayingOver !== undefined && nowPlayingOver !== here) {
    setNowPlayingOver(undefined);
  }
  const [nowPlayingQueue, setNowPlayingQueue] = useState(false);
  const playingId = current(player.queue)?.trackId;
  const playing = playingId === undefined ? undefined : byId.get(playingId);
  // An enricher set to the next to play is asked about the song playing and the one after.
  useLookAhead([playingId, upNext(player.queue)[0]?.trackId], byId, library);
  // With nothing left playing, Now Playing closes, and the next song doesn't reopen it.
  if (nowPlayingOver !== undefined && playing === undefined && library.loaded) {
    setNowPlayingOver(undefined);
  }
  const nowPlaying = nowPlayingOver !== undefined && playing !== undefined;
  // The song being added to Playlists, while its dialog is open, and what was last done.
  const [adding, setAdding] = useState<Track | undefined>(undefined);
  // The song whose details are being edited, while its dialog is open.
  // The Track whose details are edited, and whether the dialog opens on its file's songs.
  const [editing, setEditing] = useState<
    { readonly track: Track; readonly songs: boolean } | undefined
  >(undefined);
  // The link or code being added from Bilibili, and the Track whose file is being added by hand.
  const [linking, setLinking] = useState<string | undefined>(undefined);
  const [filing, setFiling] = useState<Track | undefined>(undefined);
  const [notice, setNotice] = useFading("");
  // Said to screen readers only: what the page shows where it happens, such as a lookup.
  const [said, setSaid] = useFading("");
  const [listingShortcuts, setListingShortcuts] = useState(false);
  // Whether the guide to listening on another device is open.
  const [listening, setListening] = useState(false);
  // The header stays at the top, so what else stays there sits under it, however tall it is.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = top.current;
    if (header === null || typeof ResizeObserver === "undefined") {
      return;
    }
    const measured = new ResizeObserver(() => {
      document.documentElement.style.setProperty(
        "--top-height",
        `${String(header.offsetHeight)}px`,
      );
    });
    measured.observe(header);
    return () => {
      measured.disconnect();
    };
  }, []);
  const keys = useBindings();
  // The Account's shortcuts, read again when the page is shown, as they may have
  // changed on another device.
  useEffect(() => {
    learnLayout();
    const load = () => {
      openAccount(account.id).catch(() => {
        // This browser's copy, or the defaults, serve until the server answers.
      });
    };
    const onShown = () => {
      if (document.visibilityState === "visible") {
        load();
      }
    };
    load();
    document.addEventListener("visibilitychange", onShown);
    return () => {
      document.removeEventListener("visibilitychange", onShown);
    };
  }, [account.id]);
  const actions: TrackActions = {
    onPlay: player.playList,
    onPlayAll: player.playAll,
    onPlayNext: player.playNext,
    onAdd: player.add,
    onFavorite: (track, favorite) => {
      library.setFavorite(track.id, favorite);
    },
    onRate: (track, rating) => {
      library.setRating(track.id, rating);
    },
    onAddToPlaylist: setAdding,
    onEditDetails: (track: Track) => {
      setEditing({ track, songs: false });
    },
    canFind: (lookup: Lookup, track: Track) =>
      library.findable.get(lookup.enricher)?.has(track.id) ?? false,
    // The song's cover shows the lookup as it goes; screen readers hear it asked.
    statusOf: (track: Track) =>
      coverStatusOf(library.lookups.get(track.id), library.mode?.online !== false),
    onFind: (lookup: Lookup, track: Track) => {
      library.find(lookup.enricher, track.id).then(
        () => {
          const wait =
            library.mode?.online === false ? " It waits until medleyplay is Online." : "";
          setSaid(`${lookup.notice(track.title)}${wait}`);
        },
        (failure: unknown) => {
          setSaid(failure instanceof Error ? failure.message : String(failure));
        },
      );
    },
    onAddFile: setFiling,
    // The row's mark shows the new Kind, and the notice says so, as a filter may hide the row.
    onSetKind: (track: Track, kind: Kind) => {
      library.saveDetails(track.id, { kind }).then(
        () => {
          setNotice(`“${track.title}” is now ${kind === "album" ? "an album" : "a song"}.`);
        },
        (failure: unknown) => {
          setNotice(failure instanceof Error ? failure.message : String(failure));
        },
      );
    },
    onEditSongs: (track: Track) => {
      const file = track.segment_of === null ? track : byId.get(track.segment_of);
      if (file !== undefined) {
        setEditing({ track: file, songs: true });
      }
    },
  };
  /** The way to the songs of `track`'s file from its details, and the editor to show. */
  const songsOf = (track: Track) => {
    const file = track.segment_of === null ? track : byId.get(track.segment_of);
    if (file === undefined) {
      return undefined;
    }
    const count = tracks.filter((each) => each.segment_of === file.id).length;
    const ai = LOOKUPS.find((lookup) => lookup.enricher === AI_ENRICHER);
    const asked = library.lookups.get(file.id);
    const askAi: AiAsk = {
      can: ai !== undefined && actions.canFind(ai, file),
      state: asked?.enricher === AI_ENRICHER ? asked.state : undefined,
      message: asked?.message ?? "",
      ask: () => {
        if (ai !== undefined) {
          actions.onFind(ai, file);
        }
      },
    };
    return {
      label: file.split && count > 0 ? `${String(count)} songs` : "Split into songs",
      editor: (
        <SongsEditor
          album={file}
          load={api.songs}
          check={api.checkSongList}
          artists={artists}
          ai={askAi}
          loadAudio={api.playback}
          onListen={player.pause}
          onSave={async (rows, known) => {
            await library.saveSongs(file.id, rows, known);
            setNotice(`Saved the songs of “${file.title}”.`);
          }}
          onUnsplit={async () => {
            await library.unsplit(file.id);
            setNotice(`“${file.title}” plays whole again.`);
          }}
        />
      ),
    };
  };
  const addTo = async (track: Track, ids: readonly string[], newNames: readonly string[]) => {
    await library.addToPlaylists(track, ids, newNames);
    const names = [
      ...library.playlists.filter((playlist) => ids.includes(playlist.id)).map((p) => p.name),
      ...newNames,
    ];
    setNotice(`Added “${track.title}” to ${listFormat.format(names)}.`);
  };

  // A shortcut changes what isn't in view, or isn't focused, so what it did is said.
  const shortcuts: ShortcutHandlers = {
    toggle: player.toggle,
    back: () => {
      player.seek(Math.max(0, player.position - SEEK_SECONDS));
    },
    forward: () => {
      player.seek(Math.min(player.duration ?? Infinity, player.position + SEEK_SECONDS));
    },
    previous: () => {
      if (playing !== undefined) {
        player.previous();
      }
    },
    next: () => {
      if (playing !== undefined) {
        player.next();
      }
    },
    volumeDown: () => {
      player.setVolume(stepVolume(player.volume, -1));
    },
    volumeUp: () => {
      player.setVolume(stepVolume(player.volume, 1));
    },
    mute: () => {
      player.setMuted(!player.muted);
      setNotice(player.muted ? "Sound on." : "Muted.");
    },
    shuffle: () => {
      player.shuffle(!player.shuffled);
      setNotice(shuffleSaid(!player.shuffled));
    },
    repeat: () => {
      const then = repeatAfter(player.repeat);
      player.setRepeat(then);
      setNotice(REPEATS[then].said);
    },
    favorite: () => {
      if (playing !== undefined) {
        actions.onFavorite(playing, !playing.favorite);
        setNotice(
          playing.favorite
            ? `Removed “${playing.title}” from Favorites.`
            : `Added “${playing.title}” to Favorites.`,
        );
      }
    },
    search: () => {
      document.getElementById("search")?.focus();
    },
    queue: () => {
      if (nowPlaying) {
        setNowPlayingQueue((open) => !open);
      } else if (window.matchMedia(NARROW).matches) {
        setQueueOpen((open) => !open);
      } else {
        document.getElementById("queue")?.focus();
      }
    },
    nowPlaying: () => {
      setNowPlayingOver((over) => (over === undefined && playing !== undefined ? here : undefined));
    },
    help: () => {
      setListingShortcuts(true);
    },
  };

  const signOut = () => {
    void api.signOut().finally(onSignedOut);
  };

  return (
    <div className={queueOpen ? "library queue-open" : "library"}>
      <header ref={top} className="top">
        <h1>
          <a className="wordmark" href={hrefOf({ view: "library" })}>
            <WaveformIcon weight="bold" aria-hidden />
            medleyplay
          </a>
        </h1>
        <SearchBox route={route} providers={library.providers} onLookUp={setLinking} />
        {library.mode !== null && !library.mode.online && (
          <span className="mode-note">
            <a
              className="mode-note-link"
              href={hrefOf({ view: "settings" })}
              title="See the network in Settings"
            >
              <CloudSlashIcon weight="bold" aria-hidden />
              <span>
                {stillSince === library.mode.since ? "Still offline" : "Offline"}
                <span className="why">: {offlineBecause(library.mode)}</span>
              </span>
            </a>
            {checkable(library.mode) && (
              <CheckNetwork
                onChecked={(mode) => {
                  library.modeChecked(mode);
                  setStillSince(mode.online ? null : mode.since);
                }}
              />
            )}
          </span>
        )}
        {account.role === "admin" && <WaitingDevices waiting={library.waitingDevices} />}
        <ThemeSwitch />
        <button
          type="button"
          className="icon listen-button"
          aria-label="Listen on your device"
          title="Listen on your device"
          onClick={() => {
            setListening(true);
          }}
        >
          <DeviceMobileSpeakerIcon weight="regular" aria-hidden />
        </button>
        <button
          type="button"
          className="icon keys-button"
          aria-label="Keyboard shortcuts"
          {...hintOf("Keyboard shortcuts", keys.help)}
          onClick={() => {
            setListingShortcuts(true);
          }}
        >
          <KeyboardIcon weight="regular" aria-hidden />
        </button>
        <span className="account">{account.display_name}</span>
        <button
          type="button"
          className="icon"
          aria-label="Sign out"
          title="Sign out"
          onClick={signOut}
        >
          <SignOutIcon weight="regular" aria-hidden />
        </button>
      </header>
      <Nav route={route} />
      <main>
        {library.error !== "" && <p role="alert">{library.error}</p>}
        {library.loaded ? (
          <CurrentView
            route={route}
            tracks={tracks}
            playlists={library.playlists}
            playingId={playingId}
            actions={actions}
            admin={account.role === "admin"}
            mode={library.mode}
            onModeChecked={library.modeChecked}
            onEnrichersChanged={library.refreshFindable}
            onKindsChanged={library.reloadTracks}
            waitingDevices={library.waitingDevices}
            station={station}
            accountId={account.id}
            favorites={library.favoriteGroups}
            onFavoriteArtist={library.setArtistFavorite}
            onFavoriteAlbum={library.setAlbumFavorite}
          />
        ) : (
          <p className="empty" aria-busy="true">
            Loading your music…
          </p>
        )}
      </main>
      <QueuePanel player={player} sleep={sleep} tracks={byId} />
      <PlayerBar
        player={player}
        track={playing}
        onFavorite={actions.onFavorite}
        menuActions={actions}
        queueOpen={queueOpen}
        onToggleQueue={() => {
          setQueueOpen((open) => !open);
        }}
        onOpenNowPlaying={() => {
          setNowPlayingOver(here);
        }}
        playOn={
          onHost ? undefined : (
            <PlayOn
              on={onComputer ? "computer" : "here"}
              available={canPlayOnComputer}
              failed={playOnFailed}
              onChoose={playOn}
            />
          )
        }
      />
      {linking !== undefined && (
        <AddLink
          link={linking}
          look={library.lookUpLink}
          add={library.addLink}
          onAdded={(count) => {
            const songs = count === 1 ? "1 song" : `${String(count)} songs`;
            const wait =
              library.mode?.online === false ? " They wait until medleyplay is Online." : "";
            setNotice(`Added ${songs}. They are downloading.${wait}`);
          }}
          onClose={() => {
            setLinking(undefined);
          }}
        />
      )}
      {filing !== undefined && (
        <AddFile
          track={filing}
          load={library.download}
          upload={library.addFile}
          onAdded={() => {
            setNotice(`Added the file for “${filing.title}”.`);
          }}
          onClose={() => {
            setFiling(undefined);
          }}
        />
      )}
      {nowPlaying && (
        <NowPlaying
          player={player}
          sleep={sleep}
          track={playing}
          tracks={byId}
          onFavorite={actions.onFavorite}
          menuActions={actions}
          queueOpen={nowPlayingQueue}
          onToggleQueue={() => {
            setNowPlayingQueue((open) => !open);
          }}
          onClose={() => {
            setNowPlayingOver(undefined);
          }}
        />
      )}
      {adding !== undefined && (
        <AddToPlaylist
          track={adding}
          playlists={library.playlists}
          onSave={(ids, newNames) => addTo(adding, ids, newNames)}
          onClose={() => {
            setAdding(undefined);
          }}
        />
      )}
      {editing !== undefined && (
        <EditDetails
          track={editing.track}
          load={api.details}
          onSave={async (values) => {
            await library.saveDetails(editing.track.id, values);
            setNotice(`Saved the details of “${editing.track.title}”.`);
          }}
          onReadVideo={(text) => library.readVideoText(editing.track.id, text)}
          onSetCover={(image) => library.setCover(editing.track.id, image)}
          onRemoveCover={() => library.removeCover(editing.track.id)}
          findable={LOOKUPS.filter((lookup) => actions.canFind(lookup, editing.track))}
          lookup={library.lookups.get(editing.track.id)}
          online={library.mode?.online !== false}
          onFind={(lookup) => {
            actions.onFind(lookup, editing.track);
          }}
          songs={songsOf(editing.track)}
          startOnSongs={editing.songs}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
      {listening && (
        <ListenOnDevice
          username={account.username}
          load={api.addresses}
          onClose={() => {
            setListening(false);
          }}
        />
      )}
      {listingShortcuts && (
        <ShortcutList
          onClose={() => {
            setListingShortcuts(false);
          }}
        />
      )}
      <Shortcuts on={shortcuts} />
      <p className="notice" role="status">
        {notice}
      </p>
      <p className="visually-hidden" role="status">
        {said}
      </p>
      <audio ref={audio} preload="auto" />
    </div>
  );
}

/** A value that goes back to `cleared` a few seconds after it is set, as a notice fades. */
function useFading(cleared: string) {
  const [value, setValue] = useState(cleared);
  useEffect(() => {
    if (value === cleared) {
      return;
    }
    const fade = setTimeout(() => {
      setValue(cleared);
    }, NOTICE_MS);
    return () => {
      clearTimeout(fade);
    };
  }, [value, cleared]);
  return [value, setValue] as const;
}
