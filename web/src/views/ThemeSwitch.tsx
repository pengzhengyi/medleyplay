/**
 * @file The theme switch: follow the system, or keep the page light or dark.
 */

import { type Icon, DesktopIcon, MoonIcon, SunIcon } from "@phosphor-icons/react";

import { THEMES, type Theme, useTheme } from "../theme";
import { useWords } from "../locale";

const CHOICES: Record<Theme, { readonly label: string; readonly icon: Icon }> = {
  system: { label: "Match the system", icon: DesktopIcon },
  light: { label: "Light", icon: SunIcon },
  dark: { label: "Dark", icon: MoonIcon },
};

/** Three choices in one control, the chosen one raised. */
export function ThemeSwitch() {
  const t = useWords();
  const [theme, setTheme] = useTheme();
  return (
    <div className="theme-switch" role="radiogroup" aria-label={t("Theme")}>
      {THEMES.map((choice) => {
        const { label, icon: ChoiceIcon } = CHOICES[choice];
        const chosen = choice === theme;
        const name = t(label);
        return (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={name}
            title={name}
            onClick={() => {
              setTheme(choice);
            }}
          >
            <ChoiceIcon weight={chosen ? "fill" : "regular"} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
