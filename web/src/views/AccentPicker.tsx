/**
 * @file The accent picker: medleyplay's jade, or any color, for this browser.
 *
 * The swatch opens a color square and hue slider; the field takes a hex code; the
 * dice roll a color. Each change shows at once, and the page works out a readable
 * shade of it for light and dark. The heart saves the color shown among a row of
 * tiles to choose again, each showing a large swatch with its hex on hover.
 */

import { ArrowCounterClockwiseIcon, DiceFiveIcon, HeartIcon } from "@phosphor-icons/react";
import type { CSSProperties } from "react";
import { useId, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { DEFAULT_ACCENT, forgetColor, saveColor, useAccent, useSavedColors } from "../accent";
import { inkFor, randomAccent } from "../color";

/** Choose the accent color; `random` rolls the dice. */
export function AccentPicker({ random = Math.random }: { readonly random?: () => number }) {
  const [accent, setAccent] = useAccent();
  const [open, setOpen] = useState(false);
  const square = useId();
  const shown = accent ?? DEFAULT_ACCENT;
  const colors = useSavedColors();
  const saved = colors.includes(shown);
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
        <button
          type="button"
          className={saved ? "accent-tool on" : "accent-tool"}
          aria-label="Save this color"
          aria-pressed={saved}
          title={saved ? "Forget this color" : "Save this color to choose again"}
          onClick={() => {
            if (saved) {
              forgetColor(shown);
            } else {
              saveColor(shown);
            }
          }}
        >
          <HeartIcon weight={saved ? "fill" : "regular"} aria-hidden />
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
      {colors.length > 0 && (
        <ul className="accent-saved" aria-label="Saved colors">
          {colors.map((color) => (
            <li key={color}>
              <button
                type="button"
                className={color === shown ? "accent-tile on" : "accent-tile"}
                aria-label={`Use ${color}`}
                aria-pressed={color === shown}
                data-hex={color}
                style={{ "--tile": color, "--tile-ink": inkFor(color) } as CSSProperties}
                onClick={() => {
                  setAccent(color);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      {open && (
        <HexColorPicker id={square} className="accent-square" color={shown} onChange={setAccent} />
      )}
    </div>
  );
}
