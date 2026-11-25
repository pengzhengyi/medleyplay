/** @file Album lyrics matching controls and the feedback on each song's Lyrics button. */

import { MagicWandIcon, MicrophoneStageIcon } from "@phosphor-icons/react";
import { useId } from "react";

import { useWords } from "../locale";
import type { LyricsMatchStatus, useAlbumLyricsMatch } from "./useAlbumLyricsMatch";

export function AlbumLyricsMatch({
  busy,
  confirm,
  count,
  error,
  why,
  onPress,
  onConfirm,
  onCancel,
}: Omit<ReturnType<typeof useAlbumLyricsMatch>, "results" | "reread">) {
  const t = useWords();
  return (
    <>
      <button
        type="button"
        className="fill-button song-lyrics-match"
        disabled={busy || Boolean(why)}
        aria-busy={busy}
        aria-expanded={confirm}
        title={
          why ||
          t(
            "Search enabled lyrics sites for saved songs and ask the configured AI to pick a recording",
          )
        }
        onClick={onPress}
      >
        <MagicWandIcon aria-hidden />
        {t("Auto-Match lyrics")}
      </button>
      {confirm && (
        <div className="songs-note">
          {count === 1
            ? t("Search for lyrics for one saved song?")
            : t("Search for lyrics for {{count}} saved songs?", { count })}{" "}
          {t(
            "This may make paid AI calls. Clear picks are ready to review and save in Songs. Existing lyrics are kept; new or changed rows are skipped.",
          )}
          <button type="button" className="fill-button" disabled={Boolean(why)} onClick={onConfirm}>
            {t("Start matching")}
          </button>
          <button type="button" className="link-button" onClick={onCancel}>
            {t("Cancel matching")}
          </button>
        </div>
      )}
      {error !== "" && (
        <p className="songs-note" role="status">
          {error}
        </p>
      )}
    </>
  );
}

/** Open this song's lyrics, with the last Auto-Match outcome available even without motion. */
export function SongLyricsButton({
  song,
  saved,
  match,
  onOpen,
}: {
  readonly song: string;
  readonly saved: boolean;
  readonly match: LyricsMatchStatus | undefined;
  readonly onOpen: (button: HTMLButtonElement) => void;
}) {
  const t = useWords();
  const outcome = useId();
  const action = t("Edit lyrics for {{song}}", { song });
  return (
    <>
      <button
        type="button"
        className="icon song-lyrics"
        aria-label={t("Lyrics for {{song}}", { song })}
        aria-describedby={match === undefined ? undefined : outcome}
        data-match={match?.state}
        title={
          !saved
            ? t("Save the songs first to edit lyrics")
            : match === undefined
              ? action
              : `${action} — ${match.note}`
        }
        disabled={!saved}
        onClick={(event) => {
          onOpen(event.currentTarget);
        }}
      >
        <MicrophoneStageIcon
          weight={
            match?.state === "saved"
              ? "fill"
              : match?.state === "working" || match?.state === "ready"
                ? "duotone"
                : "regular"
          }
          aria-hidden
        />
      </button>
      <span className="visually-hidden" role="status">
        {match !== undefined && <>{t("Lyrics for {{song}}", { song })}: </>}
        <span id={outcome}>{match?.note}</span>
      </span>
    </>
  );
}
