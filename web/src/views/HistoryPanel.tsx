/**
 * @file History: the songs played, newest first, to play again or add to Up next.
 *
 * A row plays its song now and leaves Up next as it is. Clearing asks once more,
 * since it clears History on every device.
 */

import { ListPlusIcon } from "@phosphor-icons/react";

import { HISTORY_LENGTHS, type HistoryLength, type Track } from "../api";
import { formatPlayed } from "../format";
import { useFormattingLocale, useWords } from "../locale";
import type { Player } from "../player/usePlayer";
import type { History } from "../player/useHistory";
import { useNow } from "../useNow";
import { Cover } from "./Cover";
import { KindMark } from "./KindMark";
import { WHY } from "./unplayable";

/** History's songs, and how many it keeps. */
export function HistoryList({
  history,
  player,
  tracks,
}: {
  readonly history: History;
  readonly player: Player;
  readonly tracks: ReadonlyMap<number, Track>;
}) {
  const t = useWords();
  const locale = useFormattingLocale();
  const now = useNow();
  const { plays } = history;
  return (
    <>
      {history.failure !== undefined && (
        <p className="error" role="alert">
          {t(
            history.failure.action === "read"
              ? "Could not read listening history: {{detail}}"
              : "Could not clear listening history: {{detail}}",
            { detail: history.failure.detail },
          )}
        </p>
      )}
      {plays === undefined && history.failure === undefined && (
        <p className="muted">{t("Loading…")}</p>
      )}
      {plays?.length === 0 && <p className="empty">{t("Nothing played yet.")}</p>}
      {plays !== undefined && plays.length > 0 && (
        <ol className="history-list">
          {plays.map((played) => {
            const track = tracks.get(played.track_id);
            const title = track?.title ?? t("A Track no longer here");
            const at = Date.parse(played.played_at);
            const playable = track?.availability === "ok";
            const when = formatPlayed(at, now, { locale, t });
            return (
              <li key={played.id} className={playable ? undefined : "unplayable"}>
                <button
                  type="button"
                  className="history-play"
                  disabled={!playable}
                  aria-label={t("Play {{title}}, {{when}}", { title, when })}
                  title={
                    playable ? t("Play now") : t(WHY[track?.availability ?? ""] ?? "Unavailable")
                  }
                  onClick={() => {
                    if (track !== undefined) {
                      player.playNow(track);
                    }
                  }}
                >
                  <Cover size="small" cover={track?.cover ?? null} className="thumb" />
                  {track !== undefined && (
                    <KindMark kind={track.kind} reason={track.kind_reason} lyrics={track} />
                  )}
                  <span className="entry-title">{title}</span>
                  <span className="entry-artist">{track?.artist}</span>
                  <time className="played-at" dateTime={played.played_at}>
                    {when}
                  </time>
                </button>
                <button
                  type="button"
                  className="icon add"
                  disabled={track === undefined}
                  aria-label={t("Add {{title}} to Up next", { title })}
                  title={t("Add to Up next")}
                  onClick={() => {
                    if (track !== undefined) {
                      player.add(track);
                    }
                  }}
                >
                  <ListPlusIcon weight="light" aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      <p className="history-length">
        <label>
          {t("Show the latest")}{" "}
          <select
            value={history.length}
            onChange={(event) => {
              history.setLength(Number(event.target.value) as HistoryLength);
            }}
          >
            {HISTORY_LENGTHS.map((length) => (
              <option key={length} value={length}>
                {length}
              </option>
            ))}
          </select>{" "}
          {t("plays", { context: "history" })}
        </label>
        {history.lengthFailure !== "" && (
          <span className="error" role="alert">
            {t("The length wasn't saved: {{detail}}", { detail: history.lengthFailure })}
          </span>
        )}
      </p>
    </>
  );
}

/** History's Clear button; `onAsk` asks once more before anything is cleared. */
export function HistoryClear({
  history,
  onAsk,
}: {
  readonly history: History;
  readonly onAsk: () => void;
}) {
  const t = useWords();
  return (
    <button
      type="button"
      className="text"
      disabled={history.plays === undefined || history.plays.length === 0}
      onClick={onAsk}
    >
      {t("Clear")}
    </button>
  );
}

/** The question Clear asks, across the panel: clear every device's History, or keep it. */
export function ClearQuestion({
  history,
  onDone,
}: {
  readonly history: History;
  readonly onDone: () => void;
}) {
  const t = useWords();
  return (
    <p className="history-confirm" role="group" aria-label={t("Clear History")}>
      <span>{t("Clear on every device?")}</span>
      <button
        type="button"
        className="text danger"
        onClick={() => {
          onDone();
          void history.clear();
        }}
      >
        {t("Clear")}
      </button>
      <button type="button" className="text" onClick={onDone}>
        {t("Keep")}
      </button>
    </p>
  );
}
