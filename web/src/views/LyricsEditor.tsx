/**
 * @file A song's lyrics, edited in its Edit details: as text, LRC or plain, or synced
 * to the song as it plays.
 *
 * Syncing plays the song and stamps each line as Space is pressed, then the next; a
 * line's time, pressed, plays from there, and each line, or every line at once, moves
 * by a tenth of a second. Saving makes them the household's lyrics, which show over
 * every other source's; removing the household's shows the next source's again.
 */

import {
  CaretLeftIcon,
  MinusIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  SkipBackIcon,
} from "@phosphor-icons/react";
import { useContext, useEffect, useEffectEvent, useId, useRef, useState } from "react";

import type { Lyrics, LyricsOrigin } from "../api";
import { formatTime } from "../format";
import { type SyncLine, linesOf, lrcOf, lrcTime, nudged, shifted, stamped } from "../lrc";
import { SongsControlsContext } from "./songsControls";

/** How far a line, or every line, moves at a press, in milliseconds. */
const NUDGE_MS = 100;

/** Where the lyrics shown came from, in words. */
const FROM: Record<LyricsOrigin, string> = {
  household: "Yours",
  sidecar: "From the .lrc file beside it",
  tag: "From its tags",
  lrclib: "Found on LRCLIB",
};

/** The player, as syncing the song's lyrics needs it. */
export interface SyncPlayer {
  /** Whether this song is the one playing, so its time is the player's. */
  readonly current: boolean;
  readonly playing: boolean;
  /** How far into this song the player is, in seconds. */
  readonly seconds: number;
  /** Play this song from its start. */
  readonly start: () => void;
  readonly toggle: () => void;
  /** Play from `seconds` into this song. */
  readonly seek: (seconds: number) => void;
}

/**
 * Edit the song's lyrics, read with `load`: `save` makes text, or an instrumental, the
 * household's, and `forget` drops the household's; `player` plays the song to sync them.
 */
export function LyricsEditor({
  load,
  save,
  forget,
  player,
}: {
  readonly load: () => Promise<Lyrics | null>;
  readonly save: (text: string, instrumental: boolean) => Promise<unknown>;
  readonly forget: () => Promise<unknown>;
  readonly player: SyncPlayer;
}) {
  const controls = useContext(SongsControlsContext);
  const textId = useId();
  const [shown, setShown] = useState<Lyrics | null>();
  const [draft, setDraft] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lines, setLines] = useState<readonly SyncLine[]>([]);
  // The line Space stamps next.
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const syncList = useRef<HTMLDivElement>(null);

  // Read once, as the editor opens; the page around it renders again as the song plays.
  const loadOnce = useEffectEvent(load);
  useEffect(() => {
    let open = true;
    loadOnce().then(
      (read) => {
        if (open) {
          setShown(read);
          setDraft(read?.text ?? "");
          setInstrumental(read?.instrumental ?? false);
        }
      },
      (failure: unknown) => {
        if (open) {
          setShown(null);
          setError(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      open = false;
    };
  }, []);

  // Syncing starts with focus in the list, so the first Space stamps a line.
  useEffect(() => {
    if (syncing) {
      syncList.current?.focus();
    }
  }, [syncing]);

  /** Show `next` as the lines, and write them back to the text. */
  const change = (next: readonly SyncLine[]) => {
    setLines(next);
    setDraft(lrcOf(next));
  };
  const stampNow = () => {
    if (!player.current || cursor >= lines.length) {
      return;
    }
    change(stamped(lines, cursor, player.seconds * 1000));
    setCursor(cursor + 1);
  };
  /** Do `work` with the dialog's other actions waiting, and go back once it is done. */
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    controls.onLock(true);
    try {
      await work();
      controls.onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
      controls.onLock(false);
    }
  };
  const unstamped = lines.filter((line) => line.at_ms === null).length;

  return (
    <section className="lyrics-editor" aria-labelledby={controls.headingId}>
      <header className="lyrics-editor-head">
        <button type="button" className="songs-back" disabled={busy} onClick={controls.onBack}>
          <CaretLeftIcon weight="bold" aria-hidden />
          Details
        </button>
        <h2 id={controls.headingId} className="songs-title" tabIndex={-1}>
          Lyrics
        </h2>
        {shown !== undefined && (
          <small
            className={shown?.origin === "household" ? "detail-origin yours" : "detail-origin"}
          >
            {shown === null ? "None yet" : FROM[shown.origin]}
          </small>
        )}
      </header>
      <div className="lyrics-editor-modes" role="group" aria-label="Edit as">
        <button
          type="button"
          className="lyrics-mode"
          aria-pressed={!syncing}
          onClick={() => {
            setSyncing(false);
          }}
        >
          Text
        </button>
        <button
          type="button"
          className="lyrics-mode"
          aria-pressed={syncing}
          disabled={instrumental || draft.trim() === ""}
          title={draft.trim() === "" ? "Write or paste the lyrics first" : undefined}
          onClick={() => {
            const next = linesOf(draft);
            setLines(next);
            const first = next.findIndex((line) => line.at_ms === null);
            setCursor(first === -1 ? 0 : first);
            setSyncing(true);
          }}
        >
          Sync to the song
        </button>
      </div>
      {!syncing ? (
        <div className="lyrics-editor-text">
          <label className="lyrics-editor-label" htmlFor={textId}>
            Lyrics, as LRC or plain text
          </label>
          <textarea
            id={textId}
            rows={14}
            value={draft}
            disabled={instrumental || busy}
            placeholder={"[00:12.34]A line, at the time it is sung\nOr every line, as written"}
            onChange={(event) => {
              setDraft(event.currentTarget.value);
            }}
          />
          <label className="lyrics-editor-instrumental">
            <input
              type="checkbox"
              checked={instrumental}
              disabled={busy}
              onChange={(event) => {
                setInstrumental(event.currentTarget.checked);
              }}
            />
            Instrumental: the song has no lyrics
          </label>
        </div>
      ) : (
        <div
          ref={syncList}
          className="lyrics-sync"
          tabIndex={-1}
          // Space stamps the next line wherever focus is in the list, rather than pressing a button.
          onKeyDown={(event) => {
            if (event.key === " ") {
              event.preventDefault();
              stampNow();
            }
          }}
        >
          <div className="lyrics-sync-bar">
            <button
              type="button"
              className="icon"
              aria-label="Play from the start"
              title="Play from the start"
              onClick={player.start}
            >
              <SkipBackIcon weight="bold" aria-hidden />
            </button>
            <button
              type="button"
              className="icon"
              aria-label={player.current && player.playing ? "Pause" : "Play"}
              disabled={!player.current}
              onClick={player.toggle}
            >
              {player.current && player.playing ? (
                <PauseIcon weight="fill" aria-hidden />
              ) : (
                <PlayIcon weight="fill" aria-hidden />
              )}
            </button>
            <span className="lyrics-sync-time">
              {player.current ? formatTime(player.seconds) : "Not playing"}
            </span>
            <span className="lyrics-sync-shift">
              <button
                type="button"
                className="icon"
                aria-label="Every line a tenth of a second earlier"
                title="Every line a tenth of a second earlier"
                onClick={() => {
                  change(shifted(lines, -NUDGE_MS));
                }}
              >
                <MinusIcon aria-hidden />
              </button>
              <button
                type="button"
                className="icon"
                aria-label="Every line a tenth of a second later"
                title="Every line a tenth of a second later"
                onClick={() => {
                  change(shifted(lines, NUDGE_MS));
                }}
              >
                <PlusIcon aria-hidden />
              </button>
            </span>
            <button
              type="button"
              className="dialog-button"
              disabled={!player.current || cursor >= lines.length}
              title="Stamp the next line at the time played (Space)"
              onClick={stampNow}
            >
              Stamp
            </button>
          </div>
          <p className="lyrics-sync-hint">
            {player.current
              ? "Press Space as each line starts. Press a line to stamp it next."
              : "Play the song from the start, then press Space as each line starts."}
          </p>
          <ol className="lyrics-sync-lines">
            {lines.map((line, index) => (
              <li
                // Lines may repeat, as a chorus does; their places tell them apart.
                key={`${String(index)}-${line.text}`}
                className={index === cursor ? "lyrics-sync-line next" : "lyrics-sync-line"}
                aria-current={index === cursor ? "step" : undefined}
              >
                <button
                  type="button"
                  className="lyrics-sync-at"
                  aria-label={
                    line.at_ms === null
                      ? `${line.text || "A pause"}: not stamped`
                      : `Play from ${lrcTime(line.at_ms)}`
                  }
                  disabled={line.at_ms === null || !player.current}
                  onClick={() => {
                    if (line.at_ms !== null) {
                      player.seek(line.at_ms / 1000);
                    }
                  }}
                >
                  {line.at_ms === null ? "--:--.--" : lrcTime(line.at_ms).slice(1, -1)}
                </button>
                <button
                  type="button"
                  className="lyrics-sync-text"
                  onClick={() => {
                    setCursor(index);
                  }}
                >
                  {line.text || "♪"}
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`${line.text || "The pause"} a tenth of a second earlier`}
                  title={`${line.text || "The pause"} a tenth of a second earlier`}
                  disabled={line.at_ms === null}
                  onClick={() => {
                    change(nudged(lines, index, -NUDGE_MS));
                  }}
                >
                  <MinusIcon aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={`${line.text || "The pause"} a tenth of a second later`}
                  title={`${line.text || "The pause"} a tenth of a second later`}
                  disabled={line.at_ms === null}
                  onClick={() => {
                    change(nudged(lines, index, NUDGE_MS));
                  }}
                >
                  <PlusIcon aria-hidden />
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
      {syncing && unstamped > 0 && (
        <p className="lyrics-sync-hint" role="status">
          {unstamped === 1
            ? "1 line isn't stamped yet."
            : `${String(unstamped)} lines aren't stamped yet.`}
        </p>
      )}
      {error !== "" && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <footer className="dialog-buttons">
        {shown?.origin === "household" && (
          <button
            type="button"
            className="secondary outline dialog-button"
            disabled={busy}
            onClick={() => void act(forget)}
          >
            Remove yours
          </button>
        )}
        <button
          type="button"
          className="dialog-button"
          disabled={busy || (!instrumental && draft.trim() === "")}
          aria-busy={busy}
          onClick={() => void act(() => save(instrumental ? "" : draft, instrumental))}
        >
          Save lyrics
        </button>
      </footer>
    </section>
  );
}
