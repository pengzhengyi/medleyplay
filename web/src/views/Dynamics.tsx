/**
 * @file Dynamics: the effect chosen in Settings, drawn behind Now Playing over its cover.
 *
 * It fades in over the still blur of the cover once it has drawn, so without WebGL, or
 * with no effect chosen, the still blur shows as before. The effect runs while Now
 * Playing is open and stops when it closes.
 */

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";

import { useDynamics } from "../dynamics";
import type { Running } from "./dynamics/renderer";

const LESS_MOTION = "(prefers-reduced-motion: reduce)";

/** The query for less motion, or `undefined` where a browser can't be asked. */
const lessMotion = () =>
  typeof window.matchMedia === "function" ? window.matchMedia(LESS_MOTION) : undefined;

/** Whether this device asks for less motion, following it as it changes. */
function useLessMotion(): boolean {
  return useSyncExternalStore(
    (changed) => {
      const query = lessMotion();
      query?.addEventListener("change", changed);
      return () => {
        query?.removeEventListener("change", changed);
      };
    },
    () => lessMotion()?.matches ?? false,
  );
}

/** The effect chosen, over the cover at `cover`, or none. */
export function Dynamics({ cover }: { readonly cover: string | null }) {
  const [effect] = useDynamics();
  const still = useLessMotion();
  const host = useRef<HTMLDivElement>(null);
  const running = useRef<Running | undefined>(undefined);
  const [drawn, setDrawn] = useState(false);
  const showCurrent = useEffectEvent((started: Running) => {
    started.show(cover);
  });

  useEffect(() => {
    const where = host.current;
    // A browser without WebGL 2 never loads the renderer; the still blur shows.
    if (effect === "off" || where === null || typeof WebGL2RenderingContext === "undefined") {
      return;
    }
    let stopped = false;
    void import("./dynamics/renderer").then(({ run }) => {
      if (stopped) {
        return;
      }
      try {
        running.current = run(where, effect, { still, onDrawn: setDrawn });
        showCurrent(running.current);
      } catch {
        // Without WebGL 2 the still blur of the cover shows, as with no effect chosen.
      }
    });
    return () => {
      stopped = true;
      running.current?.stop();
      running.current = undefined;
      setDrawn(false);
    };
  }, [effect, still]);

  useEffect(() => {
    running.current?.show(cover);
  }, [cover]);

  return (
    <div
      ref={host}
      className={drawn ? "np-dynamics np-dynamics-drawn" : "np-dynamics"}
      data-effect={effect}
      aria-hidden
    />
  );
}
