/**
 * @file The playing controls the player and Now Playing share: the play modes, Previous,
 * Play or Pause, Next, and the song's Favorite button.
 */

import {
  CircleNotchIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  RepeatOnceIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
} from "@phosphor-icons/react";
import { useState } from "react";

import type { Track } from "../api";
import { repeatAfter } from "../player/queue";
import type { Player } from "../player/usePlayer";
import { hintOf, useBindings } from "../shortcuts";
import { REPEATS, shuffleSaid } from "./playModes";

/** Shuffle, Previous, Play or Pause, Next, and Repeat, for `track` playing in `player`. */
export function Transport({
  player,
  track,
}: {
  readonly player: Player;
  readonly track: Track | undefined;
}) {
  const { status, shuffled, repeat } = player;
  // A label that changes on a focused button isn't always read out, so the change is said.
  const [said, setSaid] = useState("");
  const playing = status.kind === "playing";
  const keys = useBindings();
  return (
    <div className="controls">
      <button
        type="button"
        className={shuffled ? "icon mode on" : "icon mode"}
        aria-label="Shuffle"
        aria-pressed={shuffled}
        {...hintOf(shuffled ? "Shuffle: on" : "Shuffle: off", keys.shuffle)}
        onClick={() => {
          player.shuffle(!shuffled);
          setSaid(shuffleSaid(!shuffled));
        }}
      >
        <ShuffleIcon weight={shuffled ? "bold" : "regular"} aria-hidden />
      </button>
      <button
        type="button"
        className="icon"
        aria-label="Previous"
        {...hintOf("Previous", keys.previous)}
        onClick={player.previous}
        disabled={track === undefined}
      >
        <SkipBackIcon weight="fill" aria-hidden />
      </button>
      <button
        type="button"
        className="icon play"
        aria-label={playing ? "Pause" : "Play"}
        {...hintOf(playing ? "Pause" : "Play", keys.toggle)}
        onClick={player.toggle}
        disabled={status.kind !== "playing" && status.kind !== "paused"}
      >
        {status.kind === "preparing" ? (
          <CircleNotchIcon weight="bold" className="spin" aria-hidden />
        ) : playing ? (
          <PauseIcon weight="fill" aria-hidden />
        ) : (
          <PlayIcon weight="fill" aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="icon"
        aria-label="Next"
        {...hintOf("Next", keys.next)}
        onClick={player.next}
        disabled={track === undefined}
      >
        <SkipForwardIcon weight="fill" aria-hidden />
      </button>
      <button
        type="button"
        className={repeat === "off" ? "icon mode" : "icon mode on"}
        aria-label={REPEATS[repeat].label}
        {...hintOf(REPEATS[repeat].label, keys.repeat)}
        onClick={() => {
          const then = repeatAfter(repeat);
          player.setRepeat(then);
          setSaid(REPEATS[then].said);
        }}
      >
        {repeat === "one" ? (
          <RepeatOnceIcon weight="bold" aria-hidden />
        ) : (
          <RepeatIcon weight={repeat === "all" ? "bold" : "regular"} aria-hidden />
        )}
      </button>
      <span className="visually-hidden" role="status">
        {said}
      </span>
    </div>
  );
}

/** The heart that makes `track` a favorite, or no longer one. */
export function FavoriteButton({
  track,
  onFavorite,
}: {
  readonly track: Track;
  readonly onFavorite: (track: Track, favorite: boolean) => void;
}) {
  const keys = useBindings();
  return (
    <button
      type="button"
      className={track.favorite ? "icon heart on" : "icon heart"}
      aria-label={`Favorite ${track.title}`}
      aria-pressed={track.favorite}
      {...hintOf(track.favorite ? "Favorite" : "Not a favorite", keys.favorite)}
      onClick={() => {
        onFavorite(track, !track.favorite);
      }}
    >
      <HeartIcon weight={track.favorite ? "fill" : "regular"} aria-hidden />
    </button>
  );
}
