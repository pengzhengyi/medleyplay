/**
 * @file History: the songs played, newest first, to play again or add to Up next.
 *
 * A row plays its song now and leaves Up next as it is. Clearing asks once more,
 * since it clears History on every device.
 */

import { ListPlusIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { HISTORY_LENGTHS, type HistoryLength, type Track } from "../api";
import { formatPlayed } from "../format";
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
  const now = useNow();
  const { plays } = history;
  return (
    <>
      {history.failure !== "" && <p className="error">{history.failure}</p>}
      {plays === undefined && history.failure === "" && <p className="muted">Loading…</p>}
      {plays?.length === 0 && (
        <p className="empty">Nothing played yet. A song shows here once half of it has played.</p>
      )}
      {plays !== undefined && plays.length > 0 && (
        <ol className="history-list">
          {plays.map((played) => {
            const track = tracks.get(played.track_id);
            const title = track?.title ?? "A Track no longer here";
            const at = Date.parse(played.played_at);
            const playable = track?.availability === "ok";
            const when = formatPlayed(at, now);
            return (
              <li key={played.id} className={playable ? undefined : "unplayable"}>
                <button
                  type="button"
                  className="history-play"
                  disabled={!playable}
                  aria-label={`Play ${title}, ${when}`}
                  title={playable ? "Play now" : WHY[track?.availability ?? ""]}
                  onClick={() => {
                    if (track !== undefined) {
                      player.playNow(track);
                    }
                  }}
                >
                  <Cover cover={track?.cover ?? null} className="thumb" />
                  {track !== undefined && <KindMark kind={track.kind} reason={track.kind_reason} />}
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
                  aria-label={`Add ${title} to Up next`}
                  title="Add to Up next"
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
          Keeps the last{" "}
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
          songs
        </label>
        {history.lengthFailure !== "" && (
          <span className="error" role="alert">
            {history.lengthFailure}
          </span>
        )}
      </p>
    </>
  );
}

/** History's Clear button, which asks once more before it clears every device's History. */
export function HistoryClear({ history }: { readonly history: History }) {
  const [asking, setAsking] = useState(false);
  if (asking) {
    return (
      <span className="history-confirm" role="group" aria-label="Clear History">
        <span>On every device?</span>
        <button
          type="button"
          className="text danger"
          onClick={() => {
            setAsking(false);
            void history.clear();
          }}
        >
          Clear
        </button>
        <button
          type="button"
          className="text"
          onClick={() => {
            setAsking(false);
          }}
        >
          Keep
        </button>
      </span>
    );
  }
  return (
    <button
      type="button"
      className="text"
      disabled={history.plays === undefined || history.plays.length === 0}
      onClick={() => {
        setAsking(true);
      }}
    >
      Clear
    </button>
  );
}
