/**
 * @file The place of one part of the page whose code loads when it opens: busy while
 * the code loads, then the part, and a way forward if it fails.
 *
 * Each part has its own, so one loading never hides another. A part that fails says why
 * where it would have shown, and the rest of the page keeps working.
 */

import { Component, Fragment, type ReactNode, Suspense, useEffect, useState } from "react";

import { PartLoadError, forgetFailedLoads } from "../lazyPart";

/** Why a part isn't shown. */
type Failure = "unreachable" | "updated" | "missed" | "broken";

/**
 * Show `children`, a lazy part, inside `frame`: busy with `doing` while its code loads,
 * and saying what went wrong if it fails.
 */
export function LazyPart({
  doing,
  frame = (shown) => shown,
  children,
}: {
  readonly doing: string;
  readonly frame?: (shown: ReactNode) => ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <PartBoundary failed={(error, retry) => frame(<PartFailed error={error} retry={retry} />)}>
      <Suspense
        fallback={frame(
          <p className="empty" aria-busy="true">
            {doing}
          </p>,
        )}
      >
        {children}
      </Suspense>
    </PartBoundary>
  );
}

interface BoundaryState {
  readonly error: unknown;
  readonly failed: boolean;
  /** Moves on each try, so the part mounts afresh. */
  readonly attempt: number;
}

/** Catches a part's failure, and shows `failed` with a way to try again. */
class PartBoundary extends Component<
  {
    readonly failed: (error: unknown, retry: () => void) => ReactNode;
    readonly children: ReactNode;
  },
  BoundaryState
> {
  override state: BoundaryState = { error: undefined, failed: false, attempt: 0 };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error, failed: true };
  }

  override render() {
    if (this.state.failed) {
      return this.props.failed(this.state.error, () => {
        forgetFailedLoads();
        this.setState(({ attempt }) => ({ error: undefined, failed: false, attempt: attempt + 1 }));
      });
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

/** What went wrong, once known, and what helps. */
function PartFailed({ error, retry }: { readonly error: unknown; readonly retry: () => void }) {
  const [failure, setFailure] = useState<Failure>();
  useEffect(() => {
    let shown = true;
    void whyPartFailed(error).then((why) => {
      if (shown) {
        setFailure(why);
      }
    });
    return () => {
      shown = false;
    };
  }, [error]);

  if (failure === undefined) {
    return <p className="empty" aria-busy="true" />;
  }
  const tryAgain = (
    <button type="button" className="secondary" onClick={retry}>
      Try again
    </button>
  );
  return (
    <div className="part-failed" role="alert">
      {failure === "unreachable" && (
        <>
          <p>Can't reach medleyplay. Check the connection, then try again.</p>
          {tryAgain}
        </>
      )}
      {failure === "updated" && (
        <>
          <p>
            medleyplay was updated. Reload to open this; the music stops while the page reloads.
          </p>
          <button
            type="button"
            onClick={() => {
              location.reload();
            }}
          >
            Reload
          </button>
        </>
      )}
      {failure === "missed" && (
        <>
          <p>This part of the page didn't load.</p>
          {tryAgain}
        </>
      )}
      {failure === "broken" && (
        <>
          <p>Something went wrong here.</p>
          {tryAgain}
        </>
      )}
    </div>
  );
}

/**
 * Return why a part isn't shown: the server can't be reached, it now serves a newer
 * build than this page's, its code didn't load for another reason, or it failed to show.
 */
async function whyPartFailed(error: unknown): Promise<Failure> {
  if (!(error instanceof PartLoadError)) {
    return "broken";
  }
  let page: string;
  try {
    const answer = await fetch("/", { cache: "no-store" });
    if (!answer.ok) {
      return "unreachable";
    }
    page = await answer.text();
  } catch {
    return "unreachable";
  }
  const running = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src;
  const served =
    new DOMParser()
      .parseFromString(page, "text/html")
      .querySelector<HTMLScriptElement>('script[type="module"][src]')
      ?.getAttribute("src") ?? undefined;
  const newer =
    running !== undefined &&
    served !== undefined &&
    new URL(served, location.href).href !== running;
  return newer ? "updated" : "missed";
}
