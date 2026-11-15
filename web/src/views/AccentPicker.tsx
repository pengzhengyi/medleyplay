/**
 * @file The accent picker: medleyplay's jade, or any color, for this browser.
 *
 * The swatch opens a color square and hue slider; the field takes a hex code; the
 * dice roll a color. Each change shows at once, and the page works out a readable
 * shade of it for light and dark.
 */

import { ArrowCounterClockwiseIcon, DiceFiveIcon } from "@phosphor-icons/react";
import { useId, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { DEFAULT_ACCENT, useAccent } from "../accent";
import { randomAccent } from "../color";

/** Choose the accent color; `random` rolls the dice. */
export function AccentPicker({ random = Math.random }: { readonly random?: () => number }) {
  const [accent, setAccent] = useAccent();
  const [open, setOpen] = useState(false);
  const square = useId();
  const shown = accent ?? DEFAULT_ACCENT;
  return (
    <div className="accent-picker">
      <div className="accent-row">
        <button
          type="button"
          className="accent-swatch"
          style={{ background: shown }}
          aria-label="Pick the accent color"
          title="Pick the accent color"
          aria-expanded={open}
          aria-controls={square}
          onClick={() => {
            setOpen(!open);
          }}
        />
        <HexColorInput
          className="accent-hex"
          prefixed
          color={shown}
          aria-label="Accent color"
          onChange={setAccent}
        />
        <button
          type="button"
          className="accent-tool"
          aria-label="Random color"
          title="Random color"
          onClick={() => {
            setAccent(randomAccent(random));
          }}
        >
          <DiceFiveIcon aria-hidden />
        </button>
        {accent !== undefined && (
          <button
            type="button"
            className="accent-tool"
            aria-label="Back to jade"
            title="Back to jade"
            onClick={() => {
              setAccent(undefined);
            }}
          >
            <ArrowCounterClockwiseIcon aria-hidden />
          </button>
        )}
      </div>
      {open && (
        <HexColorPicker id={square} className="accent-square" color={shown} onChange={setAccent} />
      )}
    </div>
  );
}
