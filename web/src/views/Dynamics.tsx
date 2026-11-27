/**
 * @file Cover motion behind Now Playing. Only Mesh uses WebGL.
 */

import {
  type CSSProperties,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useDynamics } from "../dynamics";
import { coverBackdrop } from "./dynamics/coverMotion";
import type { Running } from "./dynamics/renderer";

const LESS_MOTION = "(prefers-reduced-motion: reduce)";

function watchVisibility(changed: () => void): () => void {
  document.addEventListener("visibilitychange", changed);
  return () => {
    document.removeEventListener("visibilitychange", changed);
  };
}

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
  if (effect === "mesh") return <MeshMotion cover={cover} />;
  if (effect === "off" || cover === null) return null;
  return <CoverMotion key={JSON.stringify([effect, cover])} effect={effect} cover={cover} />;
}

function CoverMotion({
  cover,
  effect,
}: {
  readonly cover: string;
  readonly effect: "flow" | "drift";
}) {
  const hidden = useSyncExternalStore(watchVisibility, () => document.hidden);
  const [backdrop, setBackdrop] = useState<Awaited<ReturnType<typeof coverBackdrop>>>();
  useEffect(() => {
    let active = true;
    void coverBackdrop(cover, effect)
      .then((prepared) => {
        if (active) setBackdrop(prepared);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [cover, effect]);
  if (backdrop === undefined) return null;
  const style =
    "colors" in backdrop
      ? ({
          "--np-cover-a": backdrop.colors[0],
          "--np-cover-b": backdrop.colors[1],
        } as CSSProperties)
      : ({ "--np-cover-image": `url("${backdrop.image}")` } as CSSProperties);
  return (
    <div
      className="np-cover-motion"
      data-effect={effect}
      data-paused={hidden ? "true" : undefined}
      aria-hidden
    >
      <div className="np-cover-motion-layer" style={style} />
    </div>
  );
}

function MeshMotion({ cover }: { readonly cover: string | null }) {
  const still = useLessMotion();
  const hidden = useSyncExternalStore(watchVisibility, () => document.hidden);
  const host = useRef<HTMLDivElement>(null);
  const running = useRef<Running | undefined>(undefined);
  const [drawn, setDrawn] = useState(false);
  const [fallback, setFallback] = useState(false);
  const showCurrent = useEffectEvent((started: Running) => {
    started.show(cover);
  });

  useEffect(() => {
    const where = host.current;
    // A browser without WebGL 2 never loads the renderer; the still blur shows.
    if (where === null || fallback || typeof WebGL2RenderingContext === "undefined") {
      return;
    }
    let stopped = false;
    void import("./dynamics/renderer").then(({ run }) => {
      if (stopped) {
        return;
      }
      try {
        running.current = run(where, {
          still,
          onDrawn: (drawn) => {
            if (!stopped) setDrawn(drawn);
          },
          onSlow: () => {
            if (stopped) return;
            stopped = true;
            running.current?.stop();
            running.current = undefined;
            setFallback(true);
          },
        });
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
  }, [still, fallback]);

  useEffect(() => {
    running.current?.show(cover);
  }, [cover]);

  return (
    <div
      ref={host}
      className={
        fallback && !still && cover !== null
          ? "np-dynamics np-dynamics-slow"
          : drawn && !fallback
            ? "np-dynamics np-dynamics-drawn"
            : "np-dynamics"
      }
      data-paused={fallback && hidden ? "true" : undefined}
      data-effect="mesh"
      aria-hidden
    />
  );
}
