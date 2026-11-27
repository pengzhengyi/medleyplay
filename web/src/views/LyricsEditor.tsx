/**
 * @file A song's lyrics, edited in its Edit details: as text, LRC or plain, or synced
 * to the song as it plays.
 *
 * Syncing plays the song and stamps each line as Space is pressed, then the next; a
 * line's time, pressed, plays from there, and each line, or every line at once, moves
 * by a tenth of a second. Finding lists the songs the lyrics sites have of a title and
 * artist, and one used fills the text, to read over before saving. Saving makes them
 * the household's lyrics, which show over every other source's; removing the
 * household's shows the next source's again.
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

import { ApiError, type Lyrics, type LyricsOption, type LyricsOrigin } from "../api";
import { formatTime } from "../format";
import { composing } from "../ime";
import { type Words, useWords } from "../locale";
import { LYRICS_SITE_NAMES } from "../lyrics";
import { type SyncLine, linesOf, lrcOf, lrcTime, nudged, shifted, stamped } from "../lrc";
import { LyricsFinder, type LyricsSearchSong } from "./LyricsFinder";
import { SongsControlsContext } from "./songsControls";

/** How far a line, or every line, moves at a press, in milliseconds. */
const NUDGE_MS = 100;
const FIND_HELP =
  "Opening Find may automatically search lyric sites and send song and candidate details to AI. Your provider may charge. Saved lyrics do not change until you save.";

function lyricWriteError(cause: unknown, t: Words): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  if (cause instanceof ApiError && cause.status === 422) {
    const limit = /^Lyrics have at most ([\d,]+) timed lines\.$/u.exec(detail)?.[1];
    if (limit !== undefined) return t("Lyrics have at most {{limit}} timed lines.", { limit });
  }
  return t("Could not change the lyrics: {{detail}}", { detail });
}

/** Where the lyrics shown came from, in words. */
const FROM: Record<LyricsOrigin, string> = {
  household: "Yours",
  sidecar: "From the .lrc file beside it",
  tag: "From its tags",
  lrclib: "Found on LRCLIB",
  netease: "Found on NetEase Cloud Music",
  suggested: "Found on the web: the nearest song LRCLIB has, not saved",
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

/** What the editor shows: the text, the lines to sync, or the songs found to take some from. */
type Mode = "text" | "sync" | "find";

/**
 * Edit the song's lyrics, read with `load`: `save` makes text, or an instrumental, the
 * household's, and `forget` drops the household's; `player` plays the song to sync them.
 * `song`, the Track as the Library names it, lets the household find its lyrics.
 * A new `refreshVersion` reads the saved lyrics again without replacing a draft.
 */
export function LyricsEditor({
  load,
  save,
  forget,
  player,
  song,
  refreshVersion,
}: {
  readonly load: () => Promise<Lyrics | null>;
  readonly save: (text: string, instrumental: boolean) => Promise<unknown>;
  readonly forget: () => Promise<unknown>;
  readonly player: SyncPlayer;
  readonly song?: LyricsSearchSong | undefined;
  readonly refreshVersion?: string;
}) {
  const t = useWords();
  const controls = useContext(SongsControlsContext);
  const textId = useId();
  const findHelpId = useId();
  const [shown, setShown] = useState<Lyrics | null>();
  const [draft, setDraft] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [mode, setMode] = useState<Mode>("text");
  const syncing = mode === "sync";
  // The song found whose lyrics fill the text, until saved or written over.
  const [taken, setTaken] = useState<LyricsOption>();
  const [lines, setLines] = useState<readonly SyncLine[]>([]);
  // The line Space stamps next.
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [writeFailure, setWriteFailure] = useState<{ readonly cause: unknown }>();
  const [readFailure, setReadFailure] = useState("");
  const [dirty, setDirty] = useState(false);
  const syncList = useRef<HTMLDivElement>(null);
  // An edit can happen while a read is still pending, before its answer reaches the editor.
  const edited = useRef(false);

  const setSyncLines = (text: string) => {
    const next = linesOf(text);
    setLines(next);
    const first = next.findIndex((line) => line.at_ms === null);
    setCursor(first === -1 ? 0 : first);
  };
  const readLyrics = useEffectEvent(load);
  const showLyrics = useEffectEvent((read: Lyrics | null) => {
    setShown(read);
    setReadFailure("");
    if (edited.current) return;
    setDraft(read?.text ?? "");
    setInstrumental(read?.instrumental ?? false);
    if (syncing) {
      if (read === null || read.instrumental || read.text.trim() === "") {
        setMode("text");
      } else {
        setSyncLines(read.text);
      }
    }
  });
  useEffect(() => {
    let open = true;
    readLyrics().then(
      (read) => {
        if (open) showLyrics(read);
      },
      (failure: unknown) => {
        if (open) {
          setReadFailure(failure instanceof Error ? failure.message : String(failure));
        }
      },
    );
    return () => {
      open = false;
    };
  }, [refreshVersion]);

  // Syncing starts with focus in the list, so the first Space stamps a line.
  useEffect(() => {
    if (syncing) {
      syncList.current?.focus();
    }
  }, [syncing]);

  /** Show `next` as the lines, and write them back to the text. */
  const change = (next: readonly SyncLine[]) => {
    edited.current = true;
    setDirty(true);
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
    if (busy) return;
    setBusy(true);
    setWriteFailure(undefined);
    controls.onLock(true);
    try {
      await work();
      controls.onDone();
    } catch (failure) {
      setWriteFailure({ cause: failure });
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
          {t(controls.backLabel ?? "Details")}
        </button>
        <h2 id={controls.headingId} className="songs-title" tabIndex={-1}>
          {t("Lyrics")}
        </h2>
        {(shown !== undefined || dirty) && (
          <small
            className={shown?.origin === "household" ? "detail-origin yours" : "detail-origin"}
          >
            {dirty ? t("Unsaved draft") : t(shown == null ? "None yet" : FROM[shown.origin])}
          </small>
        )}
      </header>
      {shown === undefined && readFailure === "" && (
        <p className="hint" role="status" aria-busy="true">
          {t("Reading the lyrics…")}
        </p>
      )}
      <div className="lyrics-editor-modes" role="group" aria-label={t("Edit as")}>
        <button
          type="button"
          className="lyrics-mode"
          aria-pressed={mode === "text"}
          disabled={busy}
          onClick={() => {
            setMode("text");
          }}
        >
          {t("Text")}
        </button>
        <button
          type="button"
          className="lyrics-mode"
          aria-pressed={syncing}
          disabled={busy || instrumental || draft.trim() === ""}
          title={draft.trim() === "" ? t("Write or paste the lyrics first") : undefined}
          onClick={() => {
            setSyncLines(draft);
            setMode("sync");
          }}
        >
          {t("Sync to the song")}
        </button>
        {song !== undefined && (
          <button
            type="button"
            className="lyrics-mode"
            aria-pressed={mode === "find"}
            aria-describedby={findHelpId}
            disabled={busy}
            onClick={() => {
              setMode("find");
            }}
          >
            {t("Find")}
          </button>
        )}
      </div>
      {song !== undefined && (
        <p id={findHelpId} className="hint">
          {t(FIND_HELP)}
        </p>
      )}
      {mode === "find" && song !== undefined ? (
        <LyricsFinder
          song={song}
          busy={busy}
          onUse={(option) => {
            edited.current = true;
            setDirty(true);
            setDraft(option.text);
            setInstrumental(option.instrumental);
            setTaken(option);
            setMode("text");
          }}
        />
      ) : !syncing ? (
        <div className="lyrics-editor-text">
          <label className="lyrics-editor-label" htmlFor={textId}>
            {t("Lyrics, as LRC or plain text")}
          </label>
          <p className="hint">
            {t(
              "Paste plain text or add an LRC timestamp at the start of each line, as in [00:12.34]. Saved lyrics take priority over the other sources.",
            )}
          </p>
          {taken !== undefined && (
            <p className="lyrics-editor-taken" role="status">
              {t("From “{{title}}” on {{site}}. Save to keep them.", {
                title: taken.title,
                site: LYRICS_SITE_NAMES[taken.provider],
              })}
            </p>
          )}
          <textarea
            id={textId}
            rows={14}
            value={draft}
            disabled={instrumental || busy}
            placeholder={t("[00:12.34]A line, at the time it is sung\nOr every line, as written")}
            onChange={(event) => {
              edited.current = true;
              setDirty(true);
              setTaken(undefined);
              setDraft(event.currentTarget.value);
            }}
          />
          <label className="lyrics-editor-instrumental">
            <input
              type="checkbox"
              checked={instrumental}
              disabled={busy}
              onChange={(event) => {
                edited.current = true;
                setDirty(true);
                setInstrumental(event.currentTarget.checked);
              }}
            />
            {t("Instrumental: the song has no lyrics")}
          </label>
        </div>
      ) : (
        <div
          ref={syncList}
          className="lyrics-sync"
          tabIndex={-1}
          // Space stamps the next line wherever focus is in the list, rather than pressing a button.
          onKeyDown={(event) => {
            if (!busy && event.key === " " && !composing(event.nativeEvent)) {
              event.preventDefault();
              stampNow();
            }
          }}
        >
          <div className="lyrics-sync-bar">
            <button
              type="button"
              className="icon"
              aria-label={t("Play from the start")}
              title={t("Play from the start")}
              onClick={player.start}
            >
              <SkipBackIcon weight="bold" aria-hidden />
            </button>
            <button
              type="button"
              className="icon"
              aria-label={t(player.current && player.playing ? "Pause" : "Play")}
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
              {player.current ? formatTime(player.seconds) : t("Not playing")}
            </span>
            <span className="lyrics-sync-shift">
              <button
                type="button"
                className="icon"
                aria-label={t("Every line a tenth of a second earlier")}
                title={t("Every line a tenth of a second earlier")}
                disabled={busy}
                onClick={() => {
                  change(shifted(lines, -NUDGE_MS));
                }}
              >
                <MinusIcon aria-hidden />
              </button>
              <button
                type="button"
                className="icon"
                aria-label={t("Every line a tenth of a second later")}
                title={t("Every line a tenth of a second later")}
                disabled={busy}
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
              disabled={busy || !player.current || cursor >= lines.length}
              title={t("Stamp the next line at the time played (Space)")}
              onClick={stampNow}
            >
              {t("Stamp")}
            </button>
          </div>
          <p className="lyrics-sync-hint">
            {t(
              player.current
                ? "Press Space as each line starts. Press a line to stamp it next."
                : "Play the song from the start, then press Space as each line starts.",
            )}
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
                      ? t("{{line}}: not stamped", { line: line.text || t("A pause") })
                      : t("Play from {{time}}", { time: lrcTime(line.at_ms) })
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
                  aria-label={t("{{line}} a tenth of a second earlier", {
                    line: line.text || t("The pause"),
                  })}
                  title={t("{{line}} a tenth of a second earlier", {
                    line: line.text || t("The pause"),
                  })}
                  disabled={busy || line.at_ms === null}
                  onClick={() => {
                    change(nudged(lines, index, -NUDGE_MS));
                  }}
                >
                  <MinusIcon aria-hidden />
                </button>
                <button
                  type="button"
                  className="icon"
                  aria-label={t("{{line}} a tenth of a second later", {
                    line: line.text || t("The pause"),
                  })}
                  title={t("{{line}} a tenth of a second later", {
                    line: line.text || t("The pause"),
                  })}
                  disabled={busy || line.at_ms === null}
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
          {t("lyrics_unstamped", { count: unstamped })}
        </p>
      )}
      {readFailure !== "" && (
        <p className="error" role="alert">
          {t("Could not read the lyrics: {{detail}}", { detail: readFailure })}
        </p>
      )}
      {writeFailure !== undefined && (
        <p className="error" role="alert">
          {lyricWriteError(writeFailure.cause, t)}
        </p>
      )}
      <footer className="dialog-buttons">
        {shown?.origin === "household" && (
          <button
            type="button"
            className="secondary outline dialog-button"
            disabled={busy}
            title={t("Remove your saved lyrics now and show the next available source")}
            onClick={() => void act(forget)}
          >
            {t("Remove yours")}
          </button>
        )}
        <button
          type="button"
          className="dialog-button"
          disabled={busy || (!instrumental && draft.trim() === "")}
          aria-busy={busy}
          onClick={() => void act(() => save(instrumental ? "" : draft, instrumental))}
        >
          {t("Save lyrics")}
        </button>
      </footer>
    </section>
  );
}
