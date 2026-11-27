/**
 * @file Splitting long files by the song list found for them, a section of Clean up.
 *
 * Each long file shown as an album that isn't split yet: the list found for it, who
 * listed it, and what makes it doubtful. *Split* splits it by that list, as it was
 * shown; *Keep* keeps it as one file, so nothing is offered for it again; *Edit songs…*
 * opens its songs to split by hand. A file with no list may have an AI asked for one,
 * from its video's text, asked again once someone agrees when it was asked in the last
 * 24 hours. *Split all* splits every file with a list at once.
 */

import { ScissorsIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useState } from "react";

import { AI_ENRICHER, ApiError, type Job, type OfferedFile, type SplitDoubt, api } from "../api";
import { formatMinutes } from "../format";
import { type Words, useWords } from "../locale";
import { AiSetUpHint } from "./AiSetUpHint";
import { AskAiAgain } from "./AskAiAgain";
import { useAiSetUp } from "./aiSetUp";

const MAX_SPLIT_BATCH = 500;
const CHECK_JOB_MS = 3000;
const activeJob = (job: Job) =>
  job.state === "queued" || job.state === "waiting" || job.state === "running";

/** What makes a list doubtful, in words. */
const DOUBTS: Record<SplitDoubt, string> = {
  lists_differ: "the video and the AI list different songs",
  long_song: "a song is so long it may be two",
  few_songs: "so few songs share the file that one may be missing",
  unknown_length: "the file's length is unknown",
  invalid: "a song starts too near the file's end",
};

/** Say who listed the songs offered, as *6 songs from the video and the AI, agreeing*. */
function listedBy(offer: NonNullable<OfferedFile["offer"]>, t: Words): string {
  const songs = t("song_count", { count: offer.songs.length });
  switch (offer.source) {
    case "both":
      return t("{{songs}} from the video and the AI, agreeing", { songs });
    case "video":
      return t("{{songs}} from the video", { songs });
    case "ai":
      return t("{{songs}} from the AI, which estimated where they start", { songs });
  }
}

/** The long files to split, each to split, keep, or edit, and all to split at once. */
export function SplitFiles({
  files,
  onChanged,
  onEditSongs,
}: {
  readonly files: readonly OfferedFile[];
  /** Called after a change, so the files are read again. */
  readonly onChanged: () => void;
  /** Open the songs of the file `trackId`, to split it by hand. */
  readonly onEditSongs?: (trackId: number) => void;
}) {
  const ai = useAiSetUp();
  const t = useWords();
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<ReadonlyMap<number, Job | null>>(new Map());
  // The file the AI was asked about lately, waiting for someone to agree to ask again.
  const [askingAgain, setAskingAgain] = useState<OfferedFile | undefined>(undefined);
  // Why a file couldn't be split, kept, or asked about, by its Track; 0 for all of them.
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const offered = files.filter((file) => file.offer !== null);
  const batch = offered.slice(0, MAX_SPLIT_BATCH);
  const readFiles = useEffectEvent(onChanged);
  useEffect(() => {
    const pending = [...asked].filter(
      (entry): entry is [number, Job] => entry[1] !== null && activeJob(entry[1]),
    );
    if (pending.length === 0) return;
    let current = true;
    const timer = setTimeout(() => {
      void Promise.all(
        pending.map(async ([track, job]) => {
          const read = await api.job(job.id).catch(() => null);
          return { track, id: job.id, read };
        }),
      ).then((results) => {
        if (!current) return;
        setAsked((before) => {
          const next = new Map(before);
          for (const { track, id, read } of results) {
            if (next.get(track)?.id === id) next.set(track, read);
          }
          return next;
        });
        if (results.some(({ read }) => read !== null && !activeJob(read))) readFiles();
      });
    }, CHECK_JOB_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [asked]);

  const run = async (key: number, work: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await work();
      setErrors((now) => without(now, key));
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      setErrors((now) => new Map(now).set(key, message));
    } finally {
      setBusy(false);
      onChanged();
    }
  };
  /** Ask the AI for the songs of `file`, `again` once someone agreed to. */
  const askAi = (file: OfferedFile, again = false) =>
    run(file.track_id, async () => {
      try {
        const job = await api.findDetails(
          AI_ENRICHER,
          file.track_id,
          again ? { hint: "" } : undefined,
        );
        setAsked((now) => new Map(now).set(file.track_id, job));
      } catch (failure) {
        if (failure instanceof ApiError && failure.code === "asked_recently") {
          setAskingAgain(file);
          return;
        }
        throw failure;
      }
    });
  const split = (chosen: readonly OfferedFile[]) =>
    api.splitFiles(
      chosen.flatMap((file) =>
        file.offer === null ? [] : [{ track_id: file.track_id, signature: file.offer.signature }],
      ),
    );
  const allError = errors.get(0);

  return (
    <section className="clean-up-section" aria-labelledby="split-files-title">
      <header className="clean-up-head">
        <h3 id="split-files-title">
          <ScissorsIcon className="clean-up-icon" weight="bold" aria-hidden />
          {t("Split albums")}
          <span className="clean-up-count">{offered.length}</span>
        </h3>
        {offered.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            onClick={() => void run(0, () => split(batch))}
          >
            {offered.length > batch.length
              ? t("Split next {{count}} albums", { count: batch.length })
              : t("Split all")}
          </button>
        )}
      </header>
      <p className="tidy-lead">
        {t(
          "Splitting creates library song entries from this file's song list without changing the audio file. Keep stops future split suggestions. Undoing a split removes its song entries, including their ratings and plays, and stops future split suggestions.",
        )}
      </p>
      {allError !== undefined && (
        <p className="error" role="alert">
          {t("Could not split the albums: {{detail}}", { detail: allError })}
        </p>
      )}
      {files.length === 0 ? (
        <p className="empty">{t("Every long file is split, or kept as one.")}</p>
      ) : (
        <ul className="tidy-list" aria-label={t("Files to split")}>
          {files.map((file) => {
            const error = errors.get(file.track_id);
            const offer = file.offer;
            const job = asked.get(file.track_id);
            const waiting = job != null && activeJob(job);
            const fileStatus =
              job === undefined
                ? t("no song list found")
                : waiting
                  ? t("The AI request for a song list is pending.")
                  : job === null
                    ? t("Could not check the AI request. You can ask again.")
                    : job.state === "failed"
                      ? t("The AI request failed. {{detail}}", { detail: job.failure_message })
                      : t("No song list is available yet. You can ask again.");
            const doubts = offer?.doubts.map((doubt) => t(DOUBTS[doubt])) ?? [];
            const caution = t("Check before splitting: {{reasons}}.", {
              reasons: doubts.join(t("; ")),
            });
            const duration =
              file.length_ms === null ? "" : formatMinutes(Math.round(file.length_ms / 60_000), t);
            return (
              <li key={file.track_id} className="tidy-row split-row">
                <div className="split-names">
                  <strong className="tidy-name">{file.title}</strong>
                  {file.artist !== "" && <span className="split-artist">{file.artist}</span>}
                </div>
                <p className="tidy-meta">
                  {[
                    duration !== "" && t("{{duration}} long", { duration }),
                    offer === null ? fileStatus : listedBy(offer, t),
                  ]
                    .filter(Boolean)
                    .join(t(", "))}
                  {doubts.length > 0 && (
                    <span className="split-doubt" title={caution}>
                      <WarningIcon weight="fill" aria-hidden />
                      <span className="visually-hidden">{caution}</span>
                    </span>
                  )}
                </p>
                <div className="tidy-actions">
                  {offer !== null && (
                    <button
                      type="button"
                      className="secondary outline dialog-button"
                      aria-label={t("Keep {{title}} as one file", { title: file.title })}
                      disabled={busy}
                      onClick={() => void run(file.track_id, () => api.keepFiles([file.track_id]))}
                    >
                      {t("Keep")}
                    </button>
                  )}
                  {onEditSongs !== undefined && (
                    <button
                      type="button"
                      className="secondary outline dialog-button"
                      aria-label={t("Edit the songs of {{title}}", { title: file.title })}
                      disabled={busy}
                      onClick={() => {
                        onEditSongs(file.track_id);
                      }}
                    >
                      {t("Edit songs…")}
                    </button>
                  )}
                  {offer === null && file.has_text && !waiting && (
                    <button
                      type="button"
                      className="secondary outline dialog-button"
                      aria-label={t("Ask the AI for the songs of {{title}}", { title: file.title })}
                      aria-disabled={ai.missing}
                      title={ai.missing ? ai.why : undefined}
                      disabled={busy}
                      onClick={() => {
                        ai.whenSetUp(() => {
                          void askAi(file);
                        });
                      }}
                    >
                      <SparkleIcon aria-hidden /> {t("Ask AI")}
                    </button>
                  )}
                  {offer !== null && (
                    <button
                      type="button"
                      className="dialog-button"
                      aria-label={t("Split {{title}} into {{songs}}", {
                        title: file.title,
                        songs: t("song_count", { count: offer.songs.length }),
                      })}
                      disabled={busy}
                      onClick={() => void run(file.track_id, () => split([file]))}
                    >
                      {t("Split")}
                    </button>
                  )}
                </div>
                {offer === null && file.has_text && (
                  <p className="split-hint">
                    <AiSetUpHint />
                  </p>
                )}
                {error !== undefined && (
                  <p className="error" role="alert">
                    {t("Could not update this album: {{detail}}", { detail: error })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {askingAgain !== undefined && (
        <AskAiAgain
          title={askingAgain.title}
          onAsk={() => {
            void askAi(askingAgain, true);
          }}
          onClose={() => {
            setAskingAgain(undefined);
          }}
        />
      )}
    </section>
  );
}

function without(errors: ReadonlyMap<number, string>, key: number): ReadonlyMap<number, string> {
  const left = new Map(errors);
  left.delete(key);
  return left;
}
