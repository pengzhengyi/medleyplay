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
import { useEffect, useId, useRef, useState } from "react";
import { HexColorInput, HexColorPicker } from "react-colorful";

import { DEFAULT_ACCENT, forgetColor, saveColor, useAccent, useSavedColors } from "../accent";
import { inkFor, randomAccent } from "../color";
import { type Words, useFormattingLocale, useWords } from "../locale";

type ColorValues = WeakMap<HTMLElement, readonly [number, number]>;

function localizePicker(
  root: HTMLElement,
  t: Words,
  locale: string,
  values: ColorValues,
): () => void {
  const number = new Intl.NumberFormat(locale, { style: "percent" });
  const update = () => {
    const hue = root.querySelector<HTMLElement>(".react-colorful__hue [role=slider]");
    const color = root.querySelector<HTMLElement>(".react-colorful__saturation [role=slider]");
    for (const [slider, label] of [
      [hue, "Hue"],
      [color, "Color"],
    ] as const) {
      if (slider !== null && slider.getAttribute("aria-label") !== t(label)) {
        slider.setAttribute("aria-label", t(label));
      }
    }
    if (color === null) return;
    const current = color.getAttribute("aria-valuetext");
    const raw = /^Saturation (\d+)%, Brightness (\d+)%$/u.exec(current ?? "");
    if (raw !== null) values.set(color, [Number(raw[1]), Number(raw[2])]);
    const value = values.get(color);
    if (value === undefined) return;
    const translated = t("Saturation {{saturation}}, Brightness {{brightness}}", {
      saturation: number.format(value[0] / 100),
      brightness: number.format(value[1] / 100),
    });
    if (translated !== current) color.setAttribute("aria-valuetext", translated);
  };
  update();
  const observer = new MutationObserver(update);
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributeFilter: ["aria-valuetext", "aria-label"],
  });
  return () => {
    observer.disconnect();
  };
}

/** Choose the accent color; `random` rolls the dice. */
export function AccentPicker({ random = Math.random }: { readonly random?: () => number }) {
  const t = useWords();
  const locale = useFormattingLocale();
  const [accent, setAccent] = useAccent();
  const [open, setOpen] = useState(false);
  const square = useId();
  const shown = accent ?? DEFAULT_ACCENT;
  const colors = useSavedColors();
  const saved = colors.includes(shown);
  const picker = useRef<HTMLDivElement>(null);
  const [pickerValues] = useState<ColorValues>(() => new WeakMap());
  useEffect(() => {
    const root = picker.current;
    if (open && root !== null) return localizePicker(root, t, locale, pickerValues);
    return undefined;
  }, [open, t, locale, pickerValues]);
  return (
    <div className="accent-picker">
      <div className="accent-row">
        <button
          type="button"
          className="accent-swatch"
          style={{ background: shown }}
          aria-label={t("Pick the accent color")}
          title={t("Pick the accent color")}
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
          aria-label={t("Accent color")}
          onChange={setAccent}
        />
        <button
          type="button"
          className="accent-tool"
          aria-label={t("Random color")}
          title={t("Random color")}
          onClick={() => {
            setAccent(randomAccent(random));
          }}
        >
          <DiceFiveIcon aria-hidden />
        </button>
        <button
          type="button"
          className={saved ? "accent-tool on" : "accent-tool"}
          aria-label={t("Save this color")}
          aria-pressed={saved}
          title={saved ? t("Forget this color") : t("Save this color to choose again")}
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
            aria-label={t("Back to jade")}
            title={t("Back to jade")}
            onClick={() => {
              setAccent(undefined);
            }}
          >
            <ArrowCounterClockwiseIcon aria-hidden />
          </button>
        )}
      </div>
      {colors.length > 0 && (
        <ul className="accent-saved" aria-label={t("Saved colors")}>
          {colors.map((color) => (
            <li key={color}>
              <button
                type="button"
                className={color === shown ? "accent-tile on" : "accent-tile"}
                aria-label={t("Use {{color}}", { color })}
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
        <div ref={picker}>
          <HexColorPicker
            id={square}
            className="accent-square"
            color={shown}
            onChange={setAccent}
          />
        </div>
      )}
    </div>
  );
}
