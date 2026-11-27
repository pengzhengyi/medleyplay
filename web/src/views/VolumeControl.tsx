/**
 * @file The volume: a button down, a bar to drag, and a button up.
 */

import { SpeakerHighIcon, SpeakerLowIcon, SpeakerSlashIcon } from "@phosphor-icons/react";
import { type CSSProperties, useRef } from "react";

import { stepVolume } from "../player/volume";
import { labelsOf, useBindings } from "../shortcuts";
import { useHeldRange } from "./useHeldRange";
import { Hint } from "./Hint";
import { useWords } from "../locale";

/**
 * Change `volume`, from 0 to 1: a button moves it one mark, and the bar once it
 * is let go. While `muted`, the bar says so, and changing the volume turns the
 * sound back on.
 */
export function VolumeControl({
  volume,
  muted = false,
  onVolume,
}: {
  readonly volume: number;
  readonly muted?: boolean;
  readonly onVolume: (volume: number) => void;
}) {
  const t = useWords();
  const bar = useRef<HTMLInputElement>(null);
  const range = useHeldRange(bar, onVolume);
  const shown = range.held ?? volume;
  const percent = Math.round(shown * 100);
  const keys = useBindings();
  return (
    <div className={muted ? "volume muted" : "volume"} role="group" aria-label={t("Volume")}>
      <Hint name={t("Volume down")} keys={keys.volumeDown}>
        <button
          type="button"
          className="icon"
          aria-label={t("Volume down")}
          onClick={() => {
            onVolume(stepVolume(volume, -1));
          }}
        >
          {muted ? (
            <SpeakerSlashIcon weight="regular" aria-hidden />
          ) : (
            <SpeakerLowIcon weight="regular" aria-hidden />
          )}
        </button>
      </Hint>
      <input
        ref={bar}
        type="range"
        aria-label={t("Volume")}
        aria-valuetext={muted ? t("Muted, {{percent}}%", { percent }) : `${String(percent)}%`}
        title={
          muted
            ? keys.mute.length === 0
              ? t("Muted. Raise the volume to restore sound.")
              : t("Muted ({{keys}} for sound)", { keys: labelsOf(keys.mute, t) })
            : t("Volume {{percent}}%", { percent })
        }
        min={0}
        max={1}
        step={0.01}
        value={shown}
        style={{ "--played": `${String(percent)}%` } as CSSProperties}
        onChange={range.onChange}
      />
      <Hint name={t("Volume up")} keys={keys.volumeUp}>
        <button
          type="button"
          className="icon"
          aria-label={t("Volume up")}
          onClick={() => {
            onVolume(stepVolume(volume, 1));
          }}
        >
          <SpeakerHighIcon weight="regular" aria-hidden />
        </button>
      </Hint>
    </div>
  );
}
