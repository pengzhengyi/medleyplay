/**
 * @file Splitting long files by the song list found for them, a section of Clean up.
 *
 * Each long file shown as an album that isn't split yet: the list found for it, who
 * listed it, and what makes it doubtful. *Split* splits it by that list, as it was
 * shown; *Keep* keeps it as one file, so nothing is offered for it again; *Edit songs…*
 * opens its songs to split by hand. A file with no list may have an AI asked for one,
 * from its video's text. *Split all* splits every file with a list at once.
 */

import { ScissorsIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type OfferedFile, type SplitDoubt, api } from "../api";
import { formatMinutes } from "../format";
import { AiSetUpHint } from "./AiSetUpHint";
import { useAiSetUp } from "./aiSetUp";

/** What makes a list doubtful, in words. */
const DOUBTS: Record<SplitDoubt, string> = {
  lists_differ: "the video and the AI list different songs",
  long_song: "a song is so long it may be two",
  few_songs: "so few songs share the file that one may be missing",
  unknown_length: "the file's length is unknown",
  invalid: "a song starts too near the file's end",
};

/** Say who listed the songs offered, as *6 songs from the video and the AI, agreeing*. */
function listedBy(offer: NonNullable<OfferedFile["offer"]>): string {
  const songs = `${String(offer.songs.length)} songs`;
  switch (offer.source) {
    case "both":
      return `${songs} from the video and the AI, agreeing`;
    case "video":
      return `${songs} from the video`;
    case "ai":
      return `${songs} from the AI, which estimated where they start`;
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
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<ReadonlySet<number>>(new Set());
  // Why a file couldn't be split, kept, or asked about, by its Track; 0 for all of them.
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const offered = files.filter((file) => file.offer !== null);

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
          Split albums
          <span className="clean-up-count">{offered.length}</span>
        </h3>
        {offered.length > 1 && (
          <button
            type="button"
            className="dialog-button"
            disabled={busy}
            onClick={() => void run(0, () => split(offered))}
          >
            Split all
          </button>
        )}
      </header>
      <p className="tidy-lead">
        These long files hold whole albums. Splitting one makes a song of each stretch its list
        names; unsplitting it in its songs puts it back as one file.
      </p>
      {allError !== undefined && (
        <p className="error" role="alert">
          {allError}
        </p>
      )}
      {files.length === 0 ? (
        <p className="empty">Every long file is split, or kept as one.</p>
      ) : (
        <ul className="tidy-list" aria-label="Files to split">
          {files.map((file) => {
            const error = errors.get(file.track_id);
            const offer = file.offer;
            const doubts = offer?.doubts.map((doubt) => DOUBTS[doubt]) ?? [];
            return (
              <li key={file.track_id} className="tidy-row split-row">
                <div className="split-names">
                  <strong className="tidy-name">{file.title}</strong>
                  {file.artist !== "" && <span className="split-artist">{file.artist}</span>}
                </div>
                <p className="tidy-meta">
                  {[
                    file.length_ms === null
                      ? undefined
                      : `${formatMinutes(Math.round(file.length_ms / 60_000))} long`,
                    offer === null
                      ? asked.has(file.track_id)
                        ? "the AI is asked for its songs, which show here once it answers"
                        : "no song list found"
                      : listedBy(offer),
                  ]
                    .filter(Boolean)
                    .join(", ")}
                  {doubts.length > 0 && (
                    <span
                      className="split-doubt"
                      title={`Check before splitting: ${doubts.join("; ")}.`}
                    >
                      <WarningIcon weight="fill" aria-hidden />
                      <span className="visually-hidden">{`Check before splitting: ${doubts.join("; ")}.`}</span>
                    </span>
                  )}
                </p>
                <div className="tidy-actions">
                  {offer !== null && (
                    <button
                      type="button"
                      className="secondary outline dialog-button"
                      aria-label={`Keep ${file.title} as one file`}
                      disabled={busy}
                      onClick={() => void run(file.track_id, () => api.keepFiles([file.track_id]))}
                    >
                      Keep
                    </button>
                  )}
                  {onEditSongs !== undefined && (
                    <button
                      type="button"
                      className="secondary outline dialog-button"
                      aria-label={`Edit the songs of ${file.title}`}
                      disabled={busy}
                      onClick={() => {
                        onEditSongs(file.track_id);
                      }}
                    >
                      Edit songs…
                    </button>
                  )}
                  {offer === null && file.has_text && !asked.has(file.track_id) && (
                    <button
                      type="button"
                      className="secondary outline dialog-button"
                      aria-label={`Ask the AI for the songs of ${file.title}`}
                      aria-disabled={ai.missing}
                      title={ai.missing ? ai.why : undefined}
                      disabled={busy}
                      onClick={() => {
                        ai.whenSetUp(() => {
                          void run(file.track_id, async () => {
                            await api.findDetails("ai-details", file.track_id);
                            setAsked((now) => new Set(now).add(file.track_id));
                          });
                        });
                      }}
                    >
                      <SparkleIcon aria-hidden /> Ask AI
                    </button>
                  )}
                  {offer !== null && (
                    <button
                      type="button"
                      className="dialog-button"
                      aria-label={`Split ${file.title} into ${String(offer.songs.length)} songs`}
                      disabled={busy}
                      onClick={() => void run(file.track_id, () => split([file]))}
                    >
                      Split
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
                    {error}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function without(errors: ReadonlyMap<number, string>, key: number): ReadonlyMap<number, string> {
  const left = new Map(errors);
  left.delete(key);
  return left;
}
