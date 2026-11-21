/**
 * @file Parts of the page whose code loads when first needed, or earlier while the
 * browser is idle.
 *
 * `React.lazy` keeps a failed load for good, so a part that failed once, as when the
 * network dropped, would fail on every open until the page reloads. A part here tries
 * once more a moment later; if that fails too, the next preload, or *Try again*, loads
 * afresh.
 */

import { type ComponentType, type LazyExoticComponent, lazy } from "react";

import { whenIdle } from "./library/stages";

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
  /** The part; while its code loads it suspends, and it throws `PartLoadError` if that fails. */
  readonly Component: ComponentType<P>;
  /** Start loading its code, if it isn't loaded or loading. */
  readonly preload: () => Promise<void>;
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
  let failed = false;
  const attempt = () => {
    loading ??= retriedOnce(load).catch((failure: unknown) => {
      // Forgotten, so the next try loads; the shown part keeps its failure until then.
      loading = undefined;
      failed = true;
      throw new PartLoadError(failure);
    });
    return loading;
  };
  const fresh = (): LazyExoticComponent<ComponentType<P>> =>
    lazy(() => attempt().then((loaded) => ({ default: loaded })));
  let current = fresh();
  const renew = () => {
    if (failed) {
      failed = false;
      current = fresh();
    }
  };
  renewals.add(renew);

  function Component(props: P) {
    const Loaded = current;
    return <Loaded {...props} />;
  }
  return {
    Component,
    preload: () => {
      renew();
      return attempt().then(() => undefined);
    },
  };
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
