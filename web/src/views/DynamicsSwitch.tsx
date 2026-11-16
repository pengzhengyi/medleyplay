/**
 * @file The Dynamics switch: no effect behind Now Playing, or one of a few over its cover.
 */

import { type Dynamics, DYNAMICS, useDynamics } from "../dynamics";

const CHOICES: Record<Dynamics, { readonly label: string; readonly about: string }> = {
  off: { label: "Off", about: "The cover, blurred and still." },
  flow: { label: "Flow", about: "The cover, blurred, flowing in slow folds." },
  drift: { label: "Drift", about: "The cover, enlarged, turning slowly." },
  mesh: { label: "Mesh", about: "The cover's colors, each a light wandering." },
};

/** The choices in one control, the chosen one raised, and what it shows. */
export function DynamicsSwitch() {
  const [dynamics, setDynamics] = useDynamics();
  return (
    <div className="dynamics-row">
      <div className="theme-switch dynamics-switch" role="radiogroup" aria-label="Dynamics">
        {DYNAMICS.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            className="dynamics-choice"
            aria-checked={choice === dynamics}
            title={CHOICES[choice].about}
            onClick={() => {
              setDynamics(choice);
            }}
          >
            {CHOICES[choice].label}
          </button>
        ))}
      </div>
      <span className="hint dynamics-about">{CHOICES[dynamics].about}</span>
    </div>
  );
}
