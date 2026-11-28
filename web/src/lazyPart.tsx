/**
 * @file Parts of the page whose code loads when first needed, or earlier while the
 * browser is idle.
 *
 * `React.lazy` keeps a failed load for good, so a part that failed once, as when the
 * network dropped, would fail on every open until the page reloads. A part here tries
 * once more a moment later; if that fails too, the next preload, or *Try again*, loads
 * afresh.
 */

import {
  type ComponentType,
  type LazyExoticComponent,
  type ReactNode,
  lazy,
  use,
  useEffect,
  useState,
} from "react";

import { whenIdle } from "./library/stages";
import { PartFrame } from "./partFrame";

/** How long a failed load waits before it tries once more, in milliseconds. */
export const RETRY_AFTER_MS = 1000;

/** A part's code didn't load: the server can't be reached, or the file is gone. */
export class PartLoadError extends Error {
  constructor(cause: unknown) {
    super("A part of the page didn't load.", { cause });
    this.name = "PartLoadError";
  }
}

/** A part of the page loaded when first needed. */
export interface Part<P extends object> {
  /** The part; uses its loading frame or suspends while loading, and throws `PartLoadError` on failure. */
  readonly Component: ComponentType<P>;
  /** Start loading its code, if it isn't loaded or loading. */
  readonly preload: () => Promise<void>;
}

interface FailedPart {
  readonly error: unknown;
}

interface PartOpening<P extends object> {
  readonly Component: LazyExoticComponent<ComponentType<P>>;
  readonly open: () => Promise<ComponentType<P>>;
  readonly failure: () => FailedPart | undefined;
}

/** How each part whose load failed starts afresh, once someone tries again. */
const renewals = new Set<() => void>();

/** Let every part whose load failed load afresh, as when someone chooses *Try again*. */
export function forgetFailedLoads(): void {
  for (const renew of renewals) {
    renew();
  }
}

/** Return a part whose code `load` gives, loaded when first rendered or preloaded. */
export function lazyPart<P extends object>(load: () => Promise<ComponentType<P>>): Part<P> {
  let loading: Promise<ComponentType<P>> | undefined;
  let ready: ComponentType<P> | undefined;
  const attempt = () => {
    if (loading === undefined) {
      const work: Promise<ComponentType<P>> = retriedOnce(load)
        .then((loaded) => {
          if (loading === work) {
            ready = loaded;
          }
          return loaded;
        })
        .catch((failure: unknown) => {
          if (loading === work) {
            loading = undefined;
          }
          throw new PartLoadError(failure);
        });
      loading = work;
    }
    return loading;
  };
  const fresh = (): PartOpening<P> => {
    let failure: FailedPart | undefined;
    const open = async () => {
      if (failure !== undefined) throw failure.error;
      try {
        return await attempt();
      } catch (error: unknown) {
        failure = { error };
        throw error;
      }
    };
    return {
      Component: lazy(() => open().then((loaded) => ({ default: loaded }))),
      open,
      failure: () => failure,
    };
  };
  let current = fresh();
  const renew = () => {
    if (current.failure() !== undefined) {
      current = fresh();
    }
  };
  renewals.add(renew);

  function Component(props: P) {
    const frame = use(PartFrame);
    const [rendering] = useState(() => ({
      framed: frame !== null,
      opening: current,
      ready,
      Loaded: ready ?? current.Component,
    }));
    if (rendering.framed) {
      return (
        <FramedPart
          opening={rendering.opening}
          initial={rendering.ready}
          frame={frame}
          props={props}
        />
      );
    }
    return (
      <PartFrame value={null}>
        <rendering.Loaded {...props} />
      </PartFrame>
    );
  }
  return {
    Component,
    preload: () => {
      renew();
      return attempt().then(() => undefined);
    },
  };
  function FramedPart({
    opening,
    initial,
    frame,
    props,
  }: {
    readonly opening: PartOpening<P>;
    readonly initial: ComponentType<P> | undefined;
    readonly frame: ReactNode;
    readonly props: P;
  }) {
    const [state, setState] = useState<
      FailedPart | { readonly Component: ComponentType<P> } | undefined
    >(() => (initial === undefined ? opening.failure() : { Component: initial }));
    useEffect(() => {
      if (state !== undefined) return;
      let shown = true;
      void opening.open().then(
        (Component) => {
          if (shown) setState({ Component });
        },
        (error: unknown) => {
          if (shown) setState({ error });
        },
      );
      return () => {
        shown = false;
      };
    }, [opening, state]);

    if (state === undefined) return frame;
    if ("error" in state) throw state.error;
    return (
      <PartFrame value={null}>
        <state.Component {...props} />
      </PartFrame>
    );
  }
}

function retriedOnce<T>(load: () => Promise<T>): Promise<T> {
  return load().catch(
    () =>
      new Promise<T>((resolve, reject) => {
        setTimeout(() => {
          load().then(resolve, reject);
        }, RETRY_AFTER_MS);
      }),
  );
}

/**
 * Load each part's code in turn, each when the browser is next idle, until `signal`
 * stops it. One at a time keeps to one connection, so the page's own reads go first;
 * a part that fails is left to load when it opens.
 */
export function preloadWhenIdle(
  parts: readonly Pick<Part<object>, "preload">[],
  signal: AbortSignal,
): void {
  const next = (index: number) => {
    const part = parts[index];
    if (part === undefined || signal.aborted) {
      return;
    }
    const cancel = whenIdle(() => {
      signal.removeEventListener("abort", cancel);
      void part.preload().then(
        () => {
          next(index + 1);
        },
        () => {
          next(index + 1);
        },
      );
    });
    signal.addEventListener("abort", cancel, { once: true });
  };
  next(0);
}
