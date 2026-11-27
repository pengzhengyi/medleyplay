/**
 * @file The Dynamics switch: no effect behind Now Playing, or one of a few over its cover.
 */

import { type Dynamics, DYNAMICS, useDynamics } from "../dynamics";
import { useWords } from "../locale";

const CHOICES: Record<Dynamics, { readonly label: string; readonly about: string }> = {
  off: { label: "Off", about: "The cover, blurred and still." },
  flow: { label: "Palette Glow", about: "Soft pools of color from the cover drift behind it" },
  drift: { label: "Soft Pan", about: "A blurred copy of the cover slowly pans and zooms" },
  mesh: { label: "Mesh", about: "The cover's colors, each a light wandering." },
};

/** The choices in one control, the chosen one raised, and what it shows. */
export function DynamicsSwitch() {
  const t = useWords();
  const [dynamics, setDynamics] = useDynamics();
  return (
    <div className="dynamics-row">
      <div className="theme-switch dynamics-switch" role="radiogroup" aria-label={t("Dynamics")}>
        {DYNAMICS.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            className="dynamics-choice"
            aria-checked={choice === dynamics}
            title={t(CHOICES[choice].about)}
            onClick={() => {
              setDynamics(choice);
            }}
          >
            {t(CHOICES[choice].label)}
          </button>
        ))}
      </div>
      <span className="hint dynamics-about">{t(CHOICES[dynamics].about)}</span>
    </div>
  );
}
