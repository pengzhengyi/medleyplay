/** @file Match saved album songs one at a time, keeping each outcome with its Track. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type SplitSong } from "../api";
import { useWords } from "../locale";
import { LYRICS_SITE_NAMES } from "../lyrics";

export interface LyricsMatchStatus {
  readonly state: "working" | "saved" | "not-matched";
  readonly note: string;
}

const notMatched = (note: string): LyricsMatchStatus => ({ state: "not-matched", note });
const pause = () => new Promise<void>((done) => setTimeout(done, 2000));

async function matchSong(
  song: SplitSong,
  check: () => void,
  show: (status: LyricsMatchStatus) => void,
  t: ReturnType<typeof useWords>,
): Promise<LyricsMatchStatus> {
  check();
  show({ state: "working", note: t("Searching lyrics sites…") });
  const job = await api.startLyricsMatch(song);
  for (;;) {
    check();
    const { state, failure_message: failure } = await api.job(job);
    if (state === "succeeded") break;
    if (state === "waiting") return notMatched(t("Search waiting; nothing saved."));
    if (state === "failed" || state === "cancelled") {
      return notMatched(failure || t("Search did not finish."));
    }
    await pause();
  }
  check();
  const id = song.track_id;
  const found = await api.lyricsFound(id);
  if (found.options.length === 0) return notMatched(t("No candidates found."));
  check();
  show({ state: "working", note: t("Checking the AI pick…") });
  await api.chooseLyricsMatch(id, job);
  for (;;) {
    check();
    const result = await api.lyricsFound(id);
    if (result.waiting) return notMatched(t("AI waiting; nothing saved."));
    if (!result.choosing) {
      const pick = result.pick;
      const option = pick === null ? undefined : result.options[pick.option];
      if (result.choice_failure !== null) return notMatched(result.choice_failure);
      if (pick === null || option === undefined) return notMatched(t("No clear match."));
      check();
      show({ state: "working", note: t("Saving lyrics…") });
      await api.applyLyricsMatch(id, job, pick.at);
      return {
        state: "saved",
        note: t("Saved lyrics from {{site}}.", { site: LYRICS_SITE_NAMES[option.provider] }),
      };
    }
    await pause();
  }
}

/** Match only on a press of Auto-Match or Start matching; closing Songs stops further requests. */
export function useAlbumLyricsMatch(songs: readonly SplitSong[], unavailable: string) {
  const t = useWords();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ReadonlyMap<number, LyricsMatchStatus>>(new Map());
  const active = useRef<AbortController | null>(null);
  const current = useRef(songs);
  useLayoutEffect(() => {
    current.current = unavailable ? [] : songs;
  }, [songs, unavailable]);
  useEffect(() => () => active.current?.abort(), []);

  const request = async (confirmed: boolean) => {
    if (active.current !== null || current.current.length === 0) return;
    const selected = current.current;
    const run = new AbortController();
    active.current = run;
    setBusy(true);
    setConfirm(false);
    try {
      if (!confirmed) {
        const preferences = await api.preferences().catch(() => undefined);
        if (run.signal.aborted || current.current.length === 0) return;
        if (preferences?.lyrics_match_confirmation !== "direct") {
          setConfirm(true);
          return;
        }
      }
      for (const song of selected) {
        if (run.signal.aborted) break;
        const show = (status: LyricsMatchStatus) => {
          if (!run.signal.aborted) {
            setResults((prior) => new Map(prior).set(song.track_id, status));
          }
        };
        const check = () => {
          run.signal.throwIfAborted();
          if (!current.current.includes(song)) throw new Error(t("Skipped: song changed."));
        };
        try {
          show(await matchSong(song, check, show, t));
        } catch (failure) {
          show(notMatched(failure instanceof Error ? failure.message : String(failure)));
        }
      }
    } finally {
      if (!run.signal.aborted) setBusy(false);
      active.current = null;
    }
  };
  const why = unavailable || (songs.length === 0 ? t("Save the songs first to match lyrics") : "");
  const closeConfirmation = () => {
    setConfirm(false);
  };
  return {
    busy,
    confirm,
    count: songs.length,
    why,
    results,
    onPress: () => {
      if (confirm) closeConfirmation();
      else void request(false);
    },
    onConfirm: () => void request(true),
    onCancel: closeConfirmation,
  };
}
