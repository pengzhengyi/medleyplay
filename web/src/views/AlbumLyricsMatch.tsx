/** @file Match saved album songs one at a time, after the listener agrees to AI calls. */
import { CircleNotchIcon, MagicWandIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type SplitSong } from "../api";
import { LYRICS_SITE_NAMES } from "../lyrics";

const pause = () => new Promise<void>((done) => setTimeout(done, 2000));

async function matchSong(song: SplitSong, check: () => void, progress: (note: string) => void) {
  check();
  progress("Searching lyrics sites…");
  const job = await api.startLyricsMatch(song);
  for (;;) {
    check();
    const { state, failure_message: failure } = await api.job(job);
    if (state === "succeeded") break;
    if (state === "waiting") return "Search waiting; nothing saved.";
    if (state === "failed" || state === "cancelled") return failure || "Search did not finish.";
    await pause();
  }
  check();
  const id = song.track_id;
  const found = await api.lyricsFound(id);
  if (found.options.length === 0) return "No candidates found.";
  check();
  progress("Checking the AI pick…");
  await api.chooseLyricsMatch(id, job);
  for (;;) {
    check();
    const result = await api.lyricsFound(id);
    if (result.waiting) return "AI waiting; nothing saved.";
    if (!result.choosing) {
      const pick = result.pick;
      const option = pick === null ? undefined : result.options[pick.option];
      if (result.choice_failure !== null) return result.choice_failure;
      if (pick === null || option === undefined) return "No clear match.";
      check();
      await api.applyLyricsMatch(id, job, pick.at);
      return `Saved lyrics from ${LYRICS_SITE_NAMES[option.provider]}.`;
    }
    await pause();
  }
}

export function AlbumLyricsMatch({
  songs,
  unavailable,
}: {
  readonly songs: readonly SplitSong[];
  readonly unavailable: string;
}) {
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ReadonlyMap<number, string>>(new Map());
  const active = useRef<AbortController | null>(null);
  const current = useRef(songs);
  useLayoutEffect(() => {
    current.current = unavailable ? [] : songs;
  }, [songs, unavailable]);
  useEffect(() => () => active.current?.abort(), []);
  const start = async () => {
    if (active.current !== null || unavailable) return;
    const run = new AbortController();
    active.current = run;
    setRunning(true);
    setConfirm(false);
    setResults(new Map());
    for (const song of songs) {
      if (run.signal.aborted) break;
      const show = (note: string) => {
        if (!run.signal.aborted) {
          setResults((prior) => new Map(prior).set(song.track_id, `${song.title}: ${note}`));
        }
      };
      const check = () => {
        run.signal.throwIfAborted();
        if (!current.current.includes(song)) throw new Error("Skipped: song changed.");
      };
      try {
        show(await matchSong(song, check, show));
      } catch (failure) {
        show(failure instanceof Error ? failure.message : String(failure));
      }
    }
    if (!run.signal.aborted) setRunning(false);
    active.current = null;
  };
  const why = unavailable || (songs.length === 0 ? "Save the songs first to match lyrics" : "");
  return (
    <>
      <button
        type="button"
        className="fill-button"
        disabled={running || Boolean(why)}
        aria-busy={running}
        aria-expanded={confirm}
        title={
          why ||
          "Search enabled lyrics sites for saved songs and ask the configured AI to pick a recording"
        }
        onClick={() => {
          setConfirm(!confirm);
        }}
      >
        {running ? <CircleNotchIcon className="spin" aria-hidden /> : <MagicWandIcon aria-hidden />}
        Auto-Match lyrics
      </button>
      {confirm && (
        <div className="songs-note">
          Search for lyrics for {songs.length} saved songs? This may make paid AI calls to choose
          recordings. Existing lyrics are kept; new or changed rows are skipped.
          <button
            type="button"
            className="fill-button"
            disabled={Boolean(why)}
            onClick={() => void start()}
          >
            Start matching
          </button>
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setConfirm(false);
            }}
          >
            Cancel matching
          </button>
        </div>
      )}
      {results.size > 0 && (
        <ul className="songs-note" aria-label="Lyrics match results" aria-live="polite">
          {[...results].map(([id, result]) => (
            <li key={id}>{result}</li>
          ))}
        </ul>
      )}
    </>
  );
}
