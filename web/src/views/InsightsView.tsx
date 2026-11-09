/**
 * @file Insights: what the Account listened to most, over all time or the last days.
 *
 * Listening time is written "about", since plays from before listening was
 * measured count their whole song; the footnote says how many did. A top song plays when clicked, then the songs below it, as a
 * Library row does.
 */

import { useMemo, useState } from "react";

import type { Track } from "../api";
import { formatListened } from "../format";
import { type Listened, insightsOf } from "../library/insights";
import { type Period, usePlayCounts } from "../library/usePlayCounts";
import { hrefOf } from "../routes";
import { Cover } from "./Cover";
import { WHY } from "./unplayable";

const PERIODS: readonly { readonly period: Period; readonly label: string }[] = [
  { period: 7, label: "Last 7 days" },
  { period: 30, label: "Last 30 days" },
  { period: "all", label: "All time" },
];

const NOTHING_PLAYED: Record<Period, string> = {
  7: "Nothing played in the last 7 days.",
  30: "Nothing played in the last 30 days.",
  all: "Nothing played yet. Once half a song has played, what you listen to most shows here.",
};

/** How many artists, albums, and songs each ranking shows. */
const SHOWN = 10;

const playsOf = (plays: number) => (plays === 1 ? "1 play" : `${String(plays)} plays`);

/** Write about how long and how often, such as `About 6 hr, 40 plays`; not timed, only how often. */
const listenedOf = ({ listenedMs, plays }: { listenedMs: number; plays: number }) =>
  listenedMs === 0 ? playsOf(plays) : `About ${formatListened(listenedMs)}, ${playsOf(plays)}`;

export function InsightsView({
  tracks,
  onPlay,
}: {
  /** Every Track, an album file split into songs too, for the plays from before its split. */
  readonly tracks: readonly Track[];
  /** Play `shown` from its entry `index`. */
  readonly onPlay: (shown: readonly Track[], index: number) => void;
}) {
  const [period, setPeriod] = useState<Period>(30);
  const { counts, failure } = usePlayCounts(period);
  const insights = useMemo(
    () => (counts === undefined ? undefined : insightsOf(tracks, counts)),
    [tracks, counts],
  );
  const topSongs = insights?.topSongs.slice(0, SHOWN) ?? [];
  return (
    <>
      <header className="view-heading insights-heading">
        <h2 className="section">Insights</h2>
        <div className="scope" role="radiogroup" aria-label="Period">
          {PERIODS.map((choice) => (
            <label key={choice.period}>
              <input
                type="radio"
                name="period"
                checked={period === choice.period}
                onChange={() => {
                  setPeriod(choice.period);
                }}
              />
              {choice.label}
            </label>
          ))}
        </div>
      </header>
      {failure !== "" && <p className="error">{failure}</p>}
      {insights === undefined && failure === "" && <p className="muted">Loading…</p>}
      {insights?.plays === 0 && <p className="empty">{NOTHING_PLAYED[period]}</p>}
      {insights !== undefined && insights.plays > 0 && (
        <div className="insights">
          <dl className="insights-totals">
            <div>
              <dt>Listening time</dt>
              <dd>
                {insights.listenedMs === 0 ? "–" : `About ${formatListened(insights.listenedMs)}`}
              </dd>
            </div>
            <div>
              <dt>Plays</dt>
              <dd>{insights.plays}</dd>
            </div>
            <div>
              <dt>Songs</dt>
              <dd>{insights.songs}</dd>
            </div>
          </dl>
          {insights.playsNotTimed > 0 && (
            <p className="muted insights-note">
              {`Not timed: ${playsOf(insights.playsNotTimed)} of whole albums or songs of unknown length.`}
            </p>
          )}
          <div className="insights-tops">
            {insights.artists[0] !== undefined && (
              <TopCard of="artist" listened={insights.artists[0]} />
            )}
            {insights.albums[0] !== undefined && (
              <TopCard of="album" listened={insights.albums[0]} />
            )}
          </div>
          <div className="insights-rankings">
            <Ranking of="artist" title="Top artists" items={insights.artists} />
            <Ranking of="album" title="Top albums" items={insights.albums} />
          </div>
          {topSongs.length > 0 && (
            <section className="insights-ranking" aria-labelledby="insights-songs">
              <h3 id="insights-songs">Top songs</h3>
              <ol className="insights-songs">
                {topSongs.map(({ track, plays }, index) => {
                  const playable = track.availability === "ok";
                  return (
                    <li key={track.id} className="insights-row">
                      <button
                        type="button"
                        className="insights-song"
                        disabled={!playable}
                        aria-label={`Play ${track.title}, ${playsOf(plays)}`}
                        title={playable ? "Play now" : WHY[track.availability]}
                        onClick={() => {
                          onPlay(
                            topSongs.map((song) => song.track),
                            index,
                          );
                        }}
                      >
                        <Cover cover={track.cover} className="thumb" />
                        <span className="entry-title">{track.title}</span>
                        <span className="entry-artist">{track.artist}</span>
                        <span className="insights-plays">{playsOf(plays)}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          )}
          <p className="muted insights-note">
            {insights.playsEstimated > 0 &&
              `Plays from before listening was measured count the whole song: ${playsOf(insights.playsEstimated)}. `}
            {"Clearing History doesn't change Insights."}
          </p>
        </div>
      )}
    </>
  );
}

type Of = "artist" | "album";

/** The page of the artist or the album `listened` is. */
const hrefTo = (of: Of, listened: Listened) =>
  of === "artist"
    ? hrefOf({ view: "artist", name: listened.name })
    : hrefOf({ view: "album", artist: listened.artist, name: listened.name });

function TopCard({ of, listened }: { readonly of: Of; readonly listened: Listened }) {
  return (
    <a className="insights-top" href={hrefTo(of, listened)}>
      <Cover cover={listened.cover} className="cover-tile insights-cover" />
      <span className="insights-top-text">
        <span className="insights-top-label">{of === "artist" ? "Top artist" : "Top album"}</span>
        <span className="insights-top-name">{listened.name}</span>
        {of === "album" && (
          <span className="group-meta">{listened.artist || "Unknown artist"}</span>
        )}
        <span className="group-meta">{listenedOf(listened)}</span>
      </span>
    </a>
  );
}

/** The most listened of `items`, each with a bar as long as its share of the first's. */
function Ranking({
  of,
  title,
  items,
}: {
  readonly of: Of;
  readonly title: string;
  readonly items: readonly Listened[];
}) {
  if (items.length === 0) {
    return null;
  }
  const shown = items.slice(0, SHOWN);
  const [first] = shown;
  const byTime = (first?.listenedMs ?? 0) > 0;
  const most = byTime ? (first?.listenedMs ?? 1) : (first?.plays ?? 1);
  const id = `insights-${of}s`;
  return (
    <section className="insights-ranking" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      <ol className="insights-bars">
        {shown.map((item) => (
          <li key={`${item.artist}\n${item.name}`} className="insights-row">
            <a className="insights-bar-link" href={hrefTo(of, item)}>
              <span className="insights-bar-name">
                {item.name}
                {of === "album" && (
                  <span className="insights-bar-artist">{item.artist || "Unknown artist"}</span>
                )}
              </span>
              <span className="insights-bar-value">{listenedOf(item)}</span>
              <span
                className="insights-bar"
                aria-hidden
                style={{
                  width: `${String(((byTime ? item.listenedMs : item.plays) / most) * 100)}%`,
                }}
              />
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
