/**
 * @file The lyrics of the song playing, beside its cover in Now Playing.
 *
 * Timed lyrics follow the song: the line sung now is large and bright, the others dim,
 * and each line, pressed, plays from its time. Scrolling them oneself stops the
 * following for a few seconds, so a line can be found. Plain lyrics read as written.
 */

import { useEffect, useRef } from "react";

import type { LyricLine, Lyrics } from "../api";
import { lineAt } from "../lyrics";

/** How long scrolling the lyrics oneself stops them following the song, in milliseconds. */
const BROWSE_MS = 4000;

/**
 * The lyrics `lyrics`, `seconds` into the song; `onSeek` plays from a line's time.
 * `undefined` lyrics are still being read, and show nothing yet.
 */
export function LyricsPanel({
  lyrics,
  seconds,
  onSeek,
}: {
  readonly lyrics: Lyrics | null | undefined;
  readonly seconds: number;
  readonly onSeek: (seconds: number) => void;
}) {
  if (lyrics === undefined) {
    return <section className="lyrics-panel" aria-label="Lyrics" aria-busy="true" />;
  }
  return (
    <section className="lyrics-panel" aria-label="Lyrics">
      {lyrics === null ? (
        <p className="lyrics-none">No lyrics for this song.</p>
      ) : lyrics.instrumental ? (
        <p className="lyrics-none">Instrumental</p>
      ) : lyrics.synced ? (
        <TimedLyrics lines={lyrics.lines} seconds={seconds} onSeek={onSeek} />
      ) : (
        <p className="lyrics-plain">{lyrics.plain}</p>
      )}
    </section>
  );
}

function TimedLyrics({
  lines,
  seconds,
  onSeek,
}: {
  readonly lines: readonly LyricLine[];
  readonly seconds: number;
  readonly onSeek: (seconds: number) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  // Until when the listener is browsing the lines, and they don't follow the song.
  const browsing = useRef(0);
  const now = lineAt(lines, seconds * 1000);
  useEffect(() => {
    const element = list.current;
    const line = element?.children[Math.max(now, 0)];
    if (element === null || !(line instanceof HTMLElement) || Date.now() < browsing.current) {
      return;
    }
    // The list scrolls smoothly, or at once for reduced motion, as its style says.
    element.scrollTop = line.offsetTop - element.clientHeight / 3;
  }, [now]);
  const browse = () => {
    browsing.current = Date.now() + BROWSE_MS;
  };
  return (
    <ol
      ref={list}
      className="lyrics-lines"
      onWheel={browse}
      onTouchMove={browse}
      onKeyDown={browse}
    >
      {lines.map((line, index) => (
        <li
          // Lines may repeat, as a chorus does; their times tell them apart.
          key={`${String(line.at_ms)}-${String(index)}`}
          className={index === now ? "lyric now" : index < now ? "lyric sung" : "lyric"}
          aria-current={index === now ? "true" : undefined}
        >
          <button
            type="button"
            className="lyric-line"
            onClick={() => {
              onSeek(line.at_ms / 1000);
            }}
          >
            {line.text === "" ? (
              <span className="lyric-pause" aria-label="A pause in the singing">
                ♪
              </span>
            ) : (
              line.text
            )}
            {line.translation !== "" && (
              <span className="lyric-translation">{line.translation}</span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The line of `lyrics` sung `seconds` into the song, for the player, with the whole line in
 * its tooltip. Between lines it stays, empty, so the player keeps its height; plain lyrics
 * have no line sung now, and show none.
 */
export function LyricNow({
  lyrics,
  seconds,
}: {
  readonly lyrics: Lyrics | null | undefined;
  readonly seconds: number;
}) {
  if (!lyrics?.synced) {
    return null;
  }
  const text = lyrics.lines[lineAt(lyrics.lines, seconds * 1000)]?.text ?? "";
  return (
    <p className="lyric-now" title={text === "" ? undefined : text}>
      {text}
    </p>
  );
}
