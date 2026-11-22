/**
 * @file The playing controls the player and Now Playing share: the play modes, Previous,
 * Play or Pause, Next, and the song's Favorite button.
 *
 * While an album plays, Previous and Next step by album, and a smaller pair inside them
 * steps by song within it; an album with no songs known has only the album steps.
 */

import {
  CaretLeftIcon,
  CaretRightIcon,
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
import { heartTitleOf } from "../heart";
import type { AlbumSteps, Step } from "../player/albumNow";
import { repeatAfter } from "../player/queue";
import type { Player } from "../player/usePlayer";
import { useBindings } from "../shortcuts";
import { REPEATS, shuffleSaid } from "./playModes";
import { Hint } from "./Hint";

/** What the player may be doing for its play button to work. */
const PLAYABLE_NOW = new Set(["playing", "paused", "blocked"]);

/** Shuffle, Previous, Play or Pause, Next, and Repeat, for `track` playing in `player`. */
export function Transport({
  player,
  track,
  steps,
}: {
  readonly player: Player;
  readonly track: Track | undefined;
  /** Where to step by song and by album, while an album plays. */
  readonly steps?: AlbumSteps | undefined;
}) {
  const { status, shuffled, repeat } = player;
  // A label that changes on a focused button isn't always read out, so the change is said.
  const [said, setSaid] = useState("");
  const playing = status.kind === "playing";
  const keys = useBindings();
  const go = (step: Step | undefined) => {
    if (step !== undefined) {
      player.playAt(step.key, step.seconds);
    }
  };
  const bySong = steps !== undefined && (steps.previousSong ?? steps.nextSong) !== undefined;
  return (
    <div className="controls">
      <Hint name={shuffled ? "Shuffle: on" : "Shuffle: off"} keys={keys.shuffle}>
        <button
          type="button"
          className={shuffled ? "icon mode on" : "icon mode"}
          aria-label="Shuffle"
          aria-pressed={shuffled}
          onClick={() => {
            player.shuffle(!shuffled);
            setSaid(shuffleSaid(!shuffled));
          }}
        >
          <ShuffleIcon weight={shuffled ? "bold" : "regular"} aria-hidden />
        </button>
      </Hint>
      {steps === undefined ? (
        <Hint name={"Previous"} keys={keys.previous}>
          <button
            type="button"
            className="icon"
            aria-label="Previous"
            onClick={player.previous}
            disabled={track === undefined}
          >
            <SkipBackIcon weight="fill" aria-hidden />
          </button>
        </Hint>
      ) : (
        <Hint name={"Previous album"} keys={keys.previousAlbum}>
          <button
            type="button"
            className="icon"
            aria-label="Previous album"
            onClick={() => {
              go(steps.previousAlbum);
            }}
          >
            <SkipBackIcon weight="fill" aria-hidden />
          </button>
        </Hint>
      )}
      {bySong && (
        <Hint name={"Previous song"} keys={keys.previous}>
          <button
            type="button"
            className="icon song-step"
            aria-label="Previous song"
            onClick={() => {
              go(steps.previousSong);
            }}
            disabled={steps.previousSong === undefined}
          >
            <CaretLeftIcon weight="bold" aria-hidden />
          </button>
        </Hint>
      )}
      <Hint name={playing ? "Pause" : "Play"} keys={keys.toggle}>
        <button
          type="button"
          className="icon play"
          aria-label={playing ? "Pause" : "Play"}
          onClick={player.toggle}
          disabled={!PLAYABLE_NOW.has(status.kind)}
        >
          {status.kind === "preparing" ? (
            <CircleNotchIcon weight="bold" className="spin" aria-hidden />
          ) : playing ? (
            <PauseIcon weight="fill" aria-hidden />
          ) : (
            <PlayIcon weight="fill" aria-hidden />
          )}
        </button>
      </Hint>
      {bySong && (
        <Hint name={"Next song"} keys={keys.next}>
          <button
            type="button"
            className="icon song-step"
            aria-label="Next song"
            onClick={() => {
              go(steps.nextSong);
            }}
            disabled={steps.nextSong === undefined}
          >
            <CaretRightIcon weight="bold" aria-hidden />
          </button>
        </Hint>
      )}
      {steps === undefined ? (
        <Hint name={"Next"} keys={keys.next}>
          <button
            type="button"
            className="icon"
            aria-label="Next"
            onClick={player.next}
            disabled={track === undefined}
          >
            <SkipForwardIcon weight="fill" aria-hidden />
          </button>
        </Hint>
      ) : (
        <Hint name={"Next album"} keys={keys.nextAlbum}>
          <button
            type="button"
            className="icon"
            aria-label="Next album"
            onClick={() => {
              go(steps.nextAlbum);
            }}
            disabled={steps.nextAlbum === undefined}
          >
            <SkipForwardIcon weight="fill" aria-hidden />
          </button>
        </Hint>
      )}
      <Hint name={REPEATS[repeat].label} keys={keys.repeat}>
        <button
          type="button"
          className={repeat === "off" ? "icon mode" : "icon mode on"}
          aria-label={REPEATS[repeat].label}
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
      </Hint>
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
    <Hint name={heartTitleOf(track.title, track.favorite)} keys={keys.favorite}>
      <button
        type="button"
        className={track.favorite ? "icon heart on" : "icon heart"}
        aria-label={`Favorite ${track.title}`}
        aria-pressed={track.favorite}
        onClick={() => {
          onFavorite(track, !track.favorite);
        }}
      >
        <HeartIcon weight={track.favorite ? "fill" : "regular"} aria-hidden />
      </button>
    </Hint>
  );
}
