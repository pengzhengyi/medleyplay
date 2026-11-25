/** @file Start Auto-Match for saved songs and display the Jobs' outcomes. */

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { api, type LyricsMatch, type SplitSong } from "../api";
import { useWords } from "../locale";

export interface LyricsMatchStatus {
  readonly state: "searching" | "working" | "saved" | "not-matched";
  readonly note: string;
}

function feedback(match: LyricsMatch, t: ReturnType<typeof useWords>): LyricsMatchStatus {
  switch (match.state) {
    case "searching":
      return { state: "searching", note: t("Searching lyrics sites…") };
    case "choosing":
      return { state: "working", note: t("Checking the AI pick…") };
    case "waiting":
      return { state: "working", note: t("Auto-Match is waiting.") };
    case "saved":
      return { state: "saved", note: t("Saved lyrics.") };
    case "skipped":
      return { state: "not-matched", note: t(match.note || "No clear match.") };
    case "failed":
      return { state: "not-matched", note: match.note || t("Search did not finish.") };
  }
}

function afterRead(
  prior: ReadonlyMap<number, LyricsMatch>,
  read: readonly LyricsMatch[],
): ReadonlyMap<number, LyricsMatch> {
  const next = new Map([...prior].filter(([, match]) => match.job_id === null));
  for (const match of read) {
    const known = prior.get(match.track_id);
    const id = match.job_id ?? 0;
    const older =
      known !== undefined &&
      (known.job_id === null ? id <= (known.previous_job_id ?? 0) : id < known.job_id);
    next.set(match.track_id, older ? known : match);
  }
  return next;
}

function afterSubmission(
  prior: ReadonlyMap<number, LyricsMatch>,
  started: readonly LyricsMatch[],
): ReadonlyMap<number, LyricsMatch> {
  const next = new Map(prior);
  for (const match of started) {
    const known = next.get(match.track_id);
    const id = match.job_id ?? match.previous_job_id ?? 0;
    if ((known?.job_id ?? 0) <= id) next.set(match.track_id, match);
  }
  return next;
}

/** Reading outcomes never submits any work; only Auto-Match or Start matching does. */
export function useAlbumLyricsMatch(
  album: number,
  songs: readonly SplitSong[],
  unavailable: string,
  version: string,
) {
  const t = useWords();
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [matches, setMatches] = useState<ReadonlyMap<number, LyricsMatch>>(new Map());
  const [reads, setReads] = useState(0);
  const active = useRef<AbortController | null>(null);
  const current = useRef(songs);
  useLayoutEffect(() => {
    current.current = unavailable ? [] : songs;
  }, [songs, unavailable]);
  useEffect(() => () => active.current?.abort(), []);
  useEffect(() => {
    let open = true;
    api.lyricsMatches(album).then(
      (read) => {
        if (open) {
          setMatches((prior) => afterRead(prior, read));
        }
      },
      () => undefined,
    );
    return () => {
      open = false;
    };
  }, [album, version, reads]);

  const request = async (confirmed: boolean) => {
    if (active.current !== null || current.current.length === 0) return;
    const selected = current.current;
    const run = new AbortController();
    active.current = run;
    setSubmitting(true);
    setConfirm(false);
    setError("");
    try {
      if (!confirmed) {
        const preferences = await api.preferences().catch(() => undefined);
        if (run.signal.aborted || current.current.length === 0) return;
        if (preferences?.lyrics_match_confirmation !== "direct") {
          setConfirm(true);
          return;
        }
      }
      const eligible = selected.filter((song) => current.current.includes(song));
      if (eligible.length === 0) return;
      const started = await api.startLyricsMatch(album, eligible);
      if (!run.signal.aborted) {
        setMatches((prior) => afterSubmission(prior, started));
        setReads((count) => count + 1);
      }
    } catch (failure) {
      if (!run.signal.aborted) {
        setError(failure instanceof Error ? failure.message : String(failure));
        setReads((count) => count + 1);
      }
    } finally {
      if (!run.signal.aborted) setSubmitting(false);
      active.current = null;
    }
  };
  const busy =
    submitting ||
    [...matches.values()].some(({ state }) => state === "searching" || state === "choosing");
  return {
    busy,
    confirm,
    count: songs.length,
    error,
    why: unavailable || (songs.length === 0 ? t("Save the songs first to match lyrics") : ""),
    results: new Map([...matches].map(([id, match]) => [id, feedback(match, t)])),
    onPress: () => {
      if (confirm) setConfirm(false);
      else void request(false);
    },
    onConfirm: () => void request(true),
    onCancel: () => {
      setConfirm(false);
    },
  };
}
