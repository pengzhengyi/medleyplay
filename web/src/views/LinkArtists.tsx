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
import { type Words, useWords } from "../locale";
import { navigate } from "../routes";
import { AiSetUpHint } from "./AiSetUpHint";
import { useAiSetUp } from "./aiSetUp";

/** The most artists offered for one name. */
const OFFERED = 3;
/** The most songs a name's song count shows. */
const SONGS_SHOWN = 8;

function errorDetail(failure: unknown, t: Words): string {
  return failure instanceof Error
    ? failure.message
    : typeof failure === "string"
      ? failure
      : t("Something went wrong here.");
}

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
  const t = useWords();
  const [error, setError] = useState<unknown>();
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
    setError(undefined);
    api.lookUpArtists(wanted).then(onChanged, (failure: unknown) => {
      setError(() => failure);
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
      setError(undefined);
      api.recommendArtists().then(onChanged, (failure: unknown) => {
        setError(() => failure);
      });
    });
  };
  const linkAll = async () => {
    setError(undefined);
    setLinkingAll(true);
    try {
      for (const row of toLink) {
        await api.linkArtist(row.named.name, row.chosen);
      }
    } catch (failure) {
      setError(() => failure);
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
          {t("Link artist names")}
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
                  : t("Ask the AI which artist each name names; it links nothing")
              }
              onClick={askAi}
            >
              {asking ? (
                <SpinnerGapIcon className="spin" aria-hidden />
              ) : (
                <SparkleIcon aria-hidden />
              )}
              {t(asking ? "Asking the AI…" : "Ask AI")}
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
              {t("artist_lookup", { count: toLookUp.length })}
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
              {t("Link {{count}} recommended", { count: toLink.length })}
            </button>
          )}
        </span>
      </header>
      <p className="tidy-lead">
        {t(
          "Names linked to one artist count as one artist, each song keeping its name as written. MusicBrainz is asked about each name, a second apart.",
        )}
      </p>
      {error !== undefined && (
        <p className="error" role="alert">
          {t("Could not update artist links: {{detail}}", {
            detail: errorDetail(error, t),
          })}
        </p>
      )}
      {shown.length === 0 ? (
        <p className="empty">{t("No artist name to link yet.")}</p>
      ) : (
        <ul className="tidy-list" aria-label={t("Artist names")}>
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
  const t = useWords();
  const [error, setError] = useState<unknown>();
  const act = (change: Promise<unknown>, then: () => void = () => undefined) => {
    setError(undefined);
    change.then(
      () => {
        then();
        onChanged();
      },
      (failure: unknown) => {
        setError(() => failure);
      },
    );
  };
  const count = t("song_count", { count: named.tracks });
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
                ? t("Not on MusicBrainz")
                : t("Linked to {{artist}}", {
                    artist: describeKnown(artists.get(named.artist_id)),
                  })}
            </span>
            {named.finding && (
              <span className="link-to">
                <SpinnerGapIcon className="spin" aria-hidden />{" "}
                {t("Finding its other names on Wikidata…")}
              </span>
            )}
          </>
        ) : named.finding ? (
          <span className="link-to">
            <SpinnerGapIcon className="spin" aria-hidden /> {t("Looking it up on MusicBrainz…")}
          </span>
        ) : named.look_up === "tidy_first" ? (
          <span className="link-to">{t("Tidy the name first, then look it up")}</span>
        ) : named.looked_at === null && offered.length === 0 ? (
          <span className="link-to">{t("Not looked up yet")}</span>
        ) : offered.length === 0 ? (
          <span className="link-to">
            {likely === undefined
              ? t("MusicBrainz knows no artist by this name")
              : t("MusicBrainz knows no artist by this name, likely {{name}}", { name: likely })}
          </span>
        ) : (
          <fieldset className="link-choices">
            <legend className="visually-hidden">
              {t("Artists for {{name}}", { name: named.name })}
            </legend>
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
                    <span
                      className="link-tag ai"
                      title={[ai.why, answeredOf(ai, t)].filter(Boolean).join("\n")}
                    >
                      <SparkleIcon aria-hidden /> {t("{{model}} suggests", { model: ai.model })}
                    </span>
                  ) : (
                    marked &&
                    artist.id === named.suggested && (
                      <span className="link-tag">{t("Goes by this name")}</span>
                    )
                  )}
                </label>
              );
            })}
          </fieldset>
        )}
        {apart && ai !== null && (
          <span className="link-to link-ai-none" title={answeredOf(ai, t)}>
            <SparkleIcon aria-hidden />{" "}
            {t("{{model}} suggests none of these: {{reason}}", { model: ai.model, reason: ai.why })}
          </span>
        )}
      </div>
      <span className="link-actions">
        {named.linked ? (
          <button
            type="button"
            className="secondary outline dialog-button"
            aria-label={t("Unlink {{name}}", { name: named.name })}
            onClick={() => {
              act(api.unlinkArtist(named.name));
            }}
          >
            {t("Unlink")}
          </button>
        ) : (
          choosing && (
            <>
              {named.looked_at === null && (
                <button
                  type="button"
                  className="secondary outline dialog-button"
                  aria-label={t("Look up {{name}}", { name: named.name })}
                  onClick={onLookUp}
                >
                  {t("Look up")}
                </button>
              )}
              {likely !== undefined && (
                <button
                  ref={linkRef}
                  type="button"
                  className="dialog-button recommended"
                  aria-label={t("Show the songs of {{name}} by {{artist}}", {
                    name: named.name,
                    artist: likely,
                  })}
                  title={t("Show its {{songs}} by {{artist}}, as the Library writes it", {
                    songs: count,
                    artist: likely,
                  })}
                  onClick={() => {
                    act(renamed(songs, named.name, likely), onLinked);
                  }}
                >
                  {t("Use {{name}}", { name: likely })}
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
                  aria-label={t("None of these for {{name}}", { name: named.name })}
                  onClick={() => {
                    act(api.linkArtist(named.name, null), onLinked);
                  }}
                >
                  {t(offered.length === 0 ? "Keep apart" : "None of these")}
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
                    aria-label={t("Link {{name}}", { name: named.name })}
                    disabled={chosen === ""}
                    onClick={() => {
                      act(api.linkArtist(named.name, chosen), onLinked);
                    }}
                  >
                    {t("Link")}
                  </button>
                  <span className="link-hint" aria-hidden>
                    <KeyReturnIcon /> {t("to link")}
                  </span>
                </span>
              )}
            </>
          )
        )}
      </span>
      {error !== undefined && (
        <p className="error" role="alert">
          {error instanceof RenameError
            ? t(error.reason, { name: error.written })
            : t("Could not change this name: {{detail}}", {
                detail: errorDetail(error, t),
              })}
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
  const t = useWords();
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
        title={t(songs.length === 1 ? "Show it in the Library" : "Show them")}
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
        {more > 0 && (
          <span className="link-songs-more">{t("and {{count}} more", { count: more })}</span>
        )}
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
    const part = song.artists.findIndex(where);
    const artist = where(song.artist)
      ? to
      : part < 0
        ? undefined
        : renamedCredit(song.artist, song.artists, part, to);
    if (part >= 0 && artist === undefined) {
      throw new RenameError(
        "Could not find the exact credit for “{{name}}”. Edit that song's artists instead.",
        from,
      );
    }
    if (artist !== undefined) {
      artists.set(artist, [...(artists.get(artist) ?? []), song.id]);
    }
  }
  const asAlbumArtist = songs.filter((song) => where(song.album_artist)).map((song) => song.id);
  if (artists.size === 0 && asAlbumArtist.length === 0) {
    throw new RenameError("No song shows “{{name}}” any more.", from);
  }
  for (const [artist, ids] of artists) {
    await api.setDetails(ids, { artist });
  }
  if (asAlbumArtist.length > 0) {
    await api.setDetails(asAlbumArtist, { album_artist: to });
  }
}

class RenameError extends Error {
  constructor(
    readonly reason: string,
    readonly written: string,
  ) {
    super(reason);
  }
}

const CREDIT_SEPARATOR = /^(?:\s*[,/&、，;；／]\s*|\s+[x×]\s+)$/iu;
const FEATURE_SEPARATOR = /^\s*([([（［【])?\s*(?:feat\.?|ft\.?|featuring)\s+$/iu;
const CLOSE_CREDIT: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "（": "）",
  "［": "］",
  "【": "】",
};

function renamedCredit(
  written: string,
  artists: readonly string[],
  part: number,
  to: string,
): string | undefined {
  const credit = artists[part];
  if (artists.length < 2 || credit === undefined || credit === "") return undefined;
  // Only replace a span if the earliest and latest ordered matches agree on its position.
  let first = -1;
  let end = 0;
  let closes = "";
  for (const [index, artist] of artists.entries()) {
    const from = written.indexOf(artist, end);
    if (from < 0 || artist === "") return undefined;
    const gap = written.slice(end, from);
    if (index === 0) {
      if (gap.trim() !== "") return undefined;
    } else if (!CREDIT_SEPARATOR.test(gap)) {
      const feature = FEATURE_SEPARATOR.exec(gap);
      if (feature === null || closes !== "") return undefined;
      closes = CLOSE_CREDIT[feature[1] ?? ""] ?? "";
    }
    if (index === part) first = from;
    end = from + artist.length;
  }
  if (written.slice(end).trim() !== closes) return undefined;
  let start = written.length;
  for (let index = artists.length - 1; index >= part; index -= 1) {
    const artist = artists[index];
    if (artist === undefined || start < artist.length) return undefined;
    start = written.lastIndexOf(artist, start - artist.length);
    if (start < 0) return undefined;
  }
  return first === start
    ? written.slice(0, start) + to + written.slice(start + credit.length)
    : undefined;
}
