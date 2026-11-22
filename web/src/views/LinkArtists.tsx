/**
 * @file Linking the Library's artist names to the artists MusicBrainz knows.
 *
 * A section of Clean up: each name with its songs, and what is known of it. A name not
 * looked up yet can be, one by one or all at once; a name looked up offers the artists
 * MusicBrainz knows by it, the one going by it exactly chosen already, to link, or
 * none of them. A name an artist already linked goes by offers that artist at once,
 * still to look up if it isn't the one. A linked name says what it is linked to, and
 * can be unlinked; while Wikidata is asked the artist's other names, the row says so.
 * Names linked to one artist count as one artist across the Library.
 *
 * Each row's actions line up at its right, so a list is worked down in one column. A
 * name's recommended artist is marked: the one an AI model recommends, when it was
 * asked, else the one going by the name exactly. *Link N recommended* links every name
 * that has one. An AI model recommending none of them marks *None of these* instead.
 * Linking a name moves to the next name's recommended action, so Enter takes it in turn.
 *
 * A name's song count opens its songs: the one song in the Library, or the name's page.
 * A name MusicBrainz knows no artist by, which starts with another name the Library has,
 * as *告五人2019超强音质的* starts with *告五人*, offers to show its songs by that name.
 */

import { KeyReturnIcon, LinkSimpleIcon, SparkleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useId, useMemo, useRef, useState } from "react";

import {
  type ArtistName,
  type ArtistNames,
  type ArtistRecommendation,
  type KnownArtist,
  type Track,
  api,
} from "../api";
import { answeredOf } from "../library/aiAnswer";
import { unlinkedOf } from "../library/cleanUp";
import { describeKnown } from "../library/knownArtists";
import { likelyNameOf } from "../library/likelyName";
import { fold } from "../library/views";
import { navigate } from "../routes";
import { AiSetUpHint } from "./AiSetUpHint";
import { useAiSetUp } from "./aiSetUp";

/** The most artists offered for one name. */
const OFFERED = 3;
/** The most songs a name's song count shows. */
const SONGS_SHOWN = 8;

/** Each name's songs, by its folded name: as artist, one of its artists, or album artist. */
function songsByName(tracks: readonly Track[]): ReadonlyMap<string, readonly Track[]> {
  const found = new Map<string, Track[]>();
  for (const track of tracks) {
    for (const key of new Set(
      [track.artist, ...track.artists, track.album_artist].map((name) => fold(name.trim())),
    )) {
      if (key !== "") {
        found.set(key, [...(found.get(key) ?? []), track]);
      }
    }
  }
  return found;
}

/** The names to link, each with what is known of it, and all to look up at once. */
export function LinkArtists({
  names,
  tracks = [],
  onChanged,
}: {
  readonly names: ArtistNames;
  /** The Library's songs, to show each name's. */
  readonly tracks?: readonly Track[];
  /** Called after a change, so the names are read again. */
  readonly onChanged: () => void;
}) {
  const [error, setError] = useState("");
  // Only a choice made here is kept; until one is, a name's recommendation is chosen.
  const [picked, setPicked] = useState<ReadonlyMap<string, string>>(new Map());
  const [linkingAll, setLinkingAll] = useState(false);
  const linkButtons = useRef(new Map<string, HTMLButtonElement>());
  const songsOf = useMemo(() => songsByName(tracks), [tracks]);
  const shown = names.names.filter((each) => each.look_up !== "never");
  const artists = new Map(names.artists.map((artist) => [artist.id, artist]));
  const written = names.names.map((each) => each.name);
  const toLookUp = shown
    .filter(
      (each) => each.look_up === "yes" && !each.linked && each.looked_at === null && !each.finding,
    )
    .map((each) => each.name);
  const rows = shown.map((named) => {
    const offered = offeredOf(named, artists);
    const choice = picked.get(named.key);
    const ai = named.recommendation ?? null;
    const aiPick = offered.some((artist) => artist.id === ai?.artist_id)
      ? (ai?.artist_id ?? undefined)
      : undefined;
    const pick = choice ?? aiPick ?? named.suggested ?? undefined;
    const chosen = pick ?? offered[0]?.id ?? "";
    const linkable = !named.linked && !named.finding && offered.length > 0;
    const recommended = linkable && pick !== undefined && chosen !== "";
    // An AI model recommending none of those offered, while nothing was picked here.
    const apart = linkable && choice === undefined && ai !== null && ai.artist_id === null;
    const unknown =
      !named.linked && !named.finding && named.looked_at !== null && offered.length === 0;
    const likely = unknown ? likelyNameOf(named.name, written) : undefined;
    return { named, offered, chosen, linkable, recommended, ai, aiPick, apart, likely };
  });
  // What can be done now comes first: a recommendation to link or a likely name to use,
  // then a choice to make, then a name still to look up; names already linked, or kept
  // apart, sink to the end.
  const readiness = (row: (typeof rows)[number]) =>
    row.named.linked
      ? 3
      : (row.recommended && !row.apart) || row.likely !== undefined
        ? 0
        : row.linkable
          ? 1
          : 2;
  rows.sort((a, b) => readiness(a) - readiness(b));
  const toLink = rows.filter((row) => row.recommended && !row.apart);
  // The server asks only about the names that may be looked up, as it is.
  const toAsk = rows.filter((row) => row.linkable && row.named.look_up === "yes").length;
  const asking = names.recommending === true;

  const lookUp = (wanted: readonly string[]) => {
    setError("");
    api.lookUpArtists(wanted).then(onChanged, (failure: unknown) => {
      setError(failure instanceof Error ? failure.message : String(failure));
    });
  };
  /** Move to the Link of the next name that can be linked after `key`. */
  const focusAfter = (key: string) => {
    const at = rows.findIndex((row) => row.named.key === key);
    const next = rows.slice(at + 1).find((row) => row.linkable || row.likely !== undefined);
    if (next !== undefined) {
      linkButtons.current.get(next.named.key)?.focus();
    }
  };
  const noAi = useAiSetUp();
  const askAi = () => {
    noAi.whenSetUp(() => {
      setError("");
      api.recommendArtists().then(onChanged, (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      });
    });
  };
  const linkAll = async () => {
    setError("");
    setLinkingAll(true);
    try {
      for (const row of toLink) {
        await api.linkArtist(row.named.name, row.chosen);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setLinkingAll(false);
      onChanged();
    }
  };
  return (
    <section className="clean-up-section" aria-labelledby="link-artists-title">
      <header className="clean-up-head">
        <h3 id="link-artists-title">
          <LinkSimpleIcon className="clean-up-icon" weight="bold" aria-hidden />
          Link artist names
          <span className="clean-up-count">{unlinkedOf(names)}</span>
        </h3>
        <span className="clean-up-head-actions">
          {(toAsk > 0 || asking) && (
            <button
              type="button"
              className="secondary outline dialog-button"
              disabled={asking}
              aria-busy={asking}
              aria-disabled={noAi.missing}
              title={
                noAi.missing
                  ? noAi.why
                  : "Ask the AI which artist each name names; it links nothing"
              }
              onClick={askAi}
            >
              {asking ? (
                <SpinnerGapIcon className="spin" aria-hidden />
              ) : (
                <SparkleIcon aria-hidden />
              )}
              {asking ? "Asking the AI…" : "Ask AI"}
            </button>
          )}
          {(toAsk > 0 || asking) && <AiSetUpHint />}
          {toLookUp.length > 0 && (
            <button
              type="button"
              className="secondary outline dialog-button"
              onClick={() => {
                lookUp(toLookUp);
              }}
            >
              {`Look up ${String(toLookUp.length)} ${toLookUp.length === 1 ? "name" : "names"}`}
            </button>
          )}
          {toLink.length > 0 && (
            <button
              type="button"
              className="dialog-button"
              disabled={linkingAll}
              aria-busy={linkingAll}
              onClick={() => void linkAll()}
            >
              {`Link ${String(toLink.length)} recommended`}
            </button>
          )}
        </span>
      </header>
      <p className="tidy-lead">
        Names linked to one artist count as one artist, each song keeping its name as written.
        MusicBrainz is asked about each name, a second apart.
      </p>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="empty">No artist name to link yet.</p>
      ) : (
        <ul className="tidy-list" aria-label="Artist names">
          {rows.map(({ named, offered, chosen, recommended, ai, aiPick, apart, likely }) => (
            <NameRow
              key={named.key}
              named={named}
              songs={songsOf.get(fold(named.name.trim())) ?? []}
              offered={offered}
              artists={artists}
              chosen={chosen}
              recommended={recommended}
              ai={ai}
              aiPick={aiPick}
              apart={apart}
              likely={likely}
              linkRef={(button) => {
                if (button === null) {
                  linkButtons.current.delete(named.key);
                } else {
                  linkButtons.current.set(named.key, button);
                }
              }}
              onPick={(id) => {
                setPicked((now) => new Map(now).set(named.key, id));
              }}
              onLookUp={() => {
                lookUp([named.name]);
              }}
              onLinked={() => {
                focusAfter(named.key);
              }}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The artists a name is offered, best first, among those known. */
function offeredOf(named: ArtistName, artists: ReadonlyMap<string, KnownArtist>): KnownArtist[] {
  return named.candidates
    .map((candidate) => artists.get(candidate.artist_id))
    .filter((artist) => artist !== undefined)
    .slice(0, OFFERED);
}

function NameRow({
  named,
  songs,
  offered,
  artists,
  chosen,
  recommended,
  ai,
  aiPick,
  apart,
  likely,
  linkRef,
  onPick,
  onLookUp,
  onLinked,
  onChanged,
}: {
  readonly named: ArtistName;
  /** The songs that show the name. */
  readonly songs: readonly Track[];
  readonly offered: readonly KnownArtist[];
  readonly artists: ReadonlyMap<string, KnownArtist>;
  /** The artist chosen to link, `""` for none. */
  readonly chosen: string;
  /** Whether the choice is a recommendation, so it and Link are marked. */
  readonly recommended: boolean;
  /** What an AI model recommended for the name, if it was asked. */
  readonly ai: ArtistRecommendation | null;
  /** The artist the AI recommended, when it is one of those offered. */
  readonly aiPick: string | undefined;
  /** Whether the AI recommended none of those offered, so *None of these* is marked. */
  readonly apart: boolean;
  /** The name the Library has that this one likely is, more written after it. */
  readonly likely: string | undefined;
  /** Holds the button of the row's recommended action, to move to it. */
  readonly linkRef: (button: HTMLButtonElement | null) => void;
  readonly onPick: (id: string) => void;
  readonly onLookUp: () => void;
  /** Called once the name is linked to an artist, to move on to the next. */
  readonly onLinked: () => void;
  readonly onChanged: () => void;
}) {
  const [error, setError] = useState("");
  const act = (change: Promise<unknown>, then: () => void = () => undefined) => {
    setError("");
    change.then(
      () => {
        then();
        onChanged();
      },
      (failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      },
    );
  };
  const count = `${String(named.tracks)} ${named.tracks === 1 ? "song" : "songs"}`;
  const choosing = !named.linked && !named.finding && named.look_up !== "tidy_first";
  return (
    <li className="tidy-row link-row">
      <div className="tidy-names-pair link-songs-anchor">
        <strong className="tidy-name">{named.name}</strong>
        <NameSongs count={count} songs={songs} name={named.name} />
      </div>
      <div className="link-state">
        {named.linked ? (
          <>
            <span className="link-to">
              {named.artist_id === null
                ? "Not on MusicBrainz"
                : `Linked to ${describeKnown(artists.get(named.artist_id))}`}
            </span>
            {named.finding && (
              <span className="link-to">
                <SpinnerGapIcon className="spin" aria-hidden /> Finding its other names on Wikidata…
              </span>
            )}
          </>
        ) : named.finding ? (
          <span className="link-to">
            <SpinnerGapIcon className="spin" aria-hidden /> Looking it up on MusicBrainz…
          </span>
        ) : named.look_up === "tidy_first" ? (
          <span className="link-to">Tidy the name first, then look it up</span>
        ) : named.looked_at === null && offered.length === 0 ? (
          <span className="link-to">Not looked up yet</span>
        ) : offered.length === 0 ? (
          <span className="link-to">
            MusicBrainz knows no artist by this name
            {likely !== undefined && <>, likely {likely}</>}
          </span>
        ) : (
          <fieldset className="link-choices">
            <legend className="visually-hidden">{`Artists for ${named.name}`}</legend>
            {offered.map((artist) => {
              const marked = recommended && !apart && chosen === artist.id;
              return (
                <label
                  key={artist.id}
                  className={marked ? "link-choice recommended" : "link-choice"}
                >
                  <input
                    type="radio"
                    className="link-choice-box"
                    name={`artist-${named.key}`}
                    checked={chosen === artist.id}
                    onChange={() => {
                      onPick(artist.id);
                    }}
                  />
                  <span>{describeKnown(artist)}</span>
                  {marked && ai !== null && artist.id === aiPick ? (
                    <span className="link-tag ai" title={`${ai.why} ${answeredOf(ai) ?? ""}`}>
                      <SparkleIcon aria-hidden /> {ai.model} suggests
                    </span>
                  ) : (
                    marked &&
                    artist.id === named.suggested && (
                      <span className="link-tag">Goes by this name</span>
                    )
                  )}
                </label>
              );
            })}
          </fieldset>
        )}
        {apart && ai !== null && (
          <span className="link-to link-ai-none" title={answeredOf(ai)}>
            <SparkleIcon aria-hidden /> {`${ai.model} suggests none of these: ${ai.why}`}
          </span>
        )}
      </div>
      <span className="link-actions">
        {named.linked ? (
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-label={`Unlink ${named.name}`}
            onClick={() => {
              act(api.unlinkArtist(named.name));
            }}
          >
            Unlink
          </button>
        ) : (
          choosing && (
            <>
              {named.looked_at === null && (
                <button
                  type="button"
                  className="secondary outline dialog-button"
                  aria-label={`Look up ${named.name}`}
                  onClick={onLookUp}
                >
                  Look up
                </button>
              )}
              {likely !== undefined && (
                <button
                  ref={linkRef}
                  type="button"
                  className="dialog-button recommended"
                  aria-label={`Show the songs of ${named.name} by ${likely}`}
                  title={`Show its ${count} by ${likely}, as the Library writes it`}
                  onClick={() => {
                    act(renamed(songs, named.name, likely), onLinked);
                  }}
                >
                  Use {likely}
                </button>
              )}
              {(named.looked_at !== null || offered.length > 0) && (
                <button
                  ref={apart ? linkRef : undefined}
                  type="button"
                  className={
                    apart
                      ? "secondary outline dialog-button recommended"
                      : "secondary outline dialog-button"
                  }
                  aria-label={`None of these for ${named.name}`}
                  onClick={() => {
                    act(api.linkArtist(named.name, null), onLinked);
                  }}
                >
                  {offered.length === 0 ? "Keep apart" : "None of these"}
                </button>
              )}
              {offered.length > 0 && (
                <span className="link-go">
                  <button
                    ref={apart ? undefined : linkRef}
                    type="button"
                    className={
                      recommended && !apart ? "dialog-button recommended" : "dialog-button"
                    }
                    aria-label={`Link ${named.name}`}
                    disabled={chosen === ""}
                    onClick={() => {
                      act(api.linkArtist(named.name, chosen), onLinked);
                    }}
                  >
                    Link
                  </button>
                  <span className="link-hint" aria-hidden>
                    <KeyReturnIcon /> to link
                  </span>
                </span>
              )}
            </>
          )
        )}
      </span>
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * A name's song count, showing its songs and their albums when hovered or focused,
 * so which artist it names can be told from them.
 */
function NameSongs({
  count,
  songs,
  name,
}: {
  readonly count: string;
  readonly songs: readonly Track[];
  /** The name, whose page shows its songs. */
  readonly name: string;
}) {
  const tip = useId();
  if (songs.length === 0) {
    return <span className="tidy-meta">{count}</span>;
  }
  const more = songs.length - SONGS_SHOWN;
  return (
    <>
      <button
        type="button"
        className="tidy-meta link-songs-count"
        aria-describedby={tip}
        title={songs.length === 1 ? "Show it in the Library" : "Show them"}
        onClick={() => {
          const [only] = songs;
          navigate(
            songs.length === 1 && only !== undefined
              ? { view: "library", focus: only.id }
              : { view: "artist", name },
          );
        }}
      >
        {count}
      </button>
      <span className="link-songs" role="tooltip" id={tip}>
        <ul className="link-songs-list">
          {songs.slice(0, SONGS_SHOWN).map((song) => (
            <li key={song.id} className="link-songs-item">
              {song.album === "" ? song.title : `${song.title} — ${song.album}`}
            </li>
          ))}
        </ul>
        {more > 0 && <span className="link-songs-more">{`and ${String(more)} more`}</span>}
      </span>
    </>
  );
}

/**
 * Show `songs` by `to` where they show `from`: as the artist, as one of the artists it
 * lists, in place of that one alone, or as the album artist.
 */
async function renamed(songs: readonly Track[], from: string, to: string): Promise<void> {
  const key = fold(from.trim());
  const where = (name: string) => fold(name.trim()) === key;
  const artists = new Map<string, number[]>();
  for (const song of songs) {
    const part = song.artists.find(where);
    const artist = where(song.artist)
      ? to
      : part === undefined
        ? undefined
        : song.artist.replace(part, to);
    if (artist !== undefined) {
      artists.set(artist, [...(artists.get(artist) ?? []), song.id]);
    }
  }
  const asAlbumArtist = songs.filter((song) => where(song.album_artist)).map((song) => song.id);
  if (artists.size === 0 && asAlbumArtist.length === 0) {
    throw new Error(`No song shows “${from}” any more.`);
  }
  for (const [artist, ids] of artists) {
    await api.setDetails(ids, { artist });
  }
  if (asAlbumArtist.length > 0) {
    await api.setDetails(asAlbumArtist, { album_artist: to });
  }
}
