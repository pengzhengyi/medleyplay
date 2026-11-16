import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseDynamics } from "../dynamics";
import { Dynamics } from "./Dynamics";

/** What the renderer was asked to do, in order. */
const calls: string[] = [];
let drawn: ((drawn: boolean) => void) | undefined;

vi.mock("./dynamics/renderer", () => ({
  run: (
    _host: HTMLElement,
    effect: string,
    { still, onDrawn }: { still: boolean; onDrawn: (drawn: boolean) => void },
  ) => {
    calls.push(`run ${effect}${still ? " still" : ""}`);
    drawn = onDrawn;
    return {
      show: (url: string | null) => calls.push(`show ${String(url)}`),
      stop: () => calls.push("stop"),
    };
  },
}));

/** Let the renderer module load, as it does on first use. */
const loaded = () => act(() => vi.dynamicImportSettled());

beforeEach(() => {
  calls.length = 0;
  drawn = undefined;
  // jsdom draws nothing, so these tests stand in a browser with WebGL 2.
  vi.stubGlobal("WebGL2RenderingContext", vi.fn());
});

afterEach(() => {
  chooseDynamics("flow");
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Dynamics behind Now Playing", () => {
  it("runs the effect chosen over the cover, and fades in once drawn", async () => {
    const { container } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();
    const layer = container.querySelector(".np-dynamics");
    const before = layer?.className;

    act(() => drawn?.(true));

    expect(calls).toEqual(["run flow", "show /api/covers/a"]);
    expect(before).toBe("np-dynamics");
    expect(layer).toHaveClass("np-dynamics-drawn");
  });

  it("follows the cover as the song changes", async () => {
    const { rerender } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    rerender(<Dynamics cover="/api/covers/b" />);

    expect(calls).toEqual(["run flow", "show /api/covers/a", "show /api/covers/b"]);
  });

  it("starts the effect chosen again when another is chosen, and runs none when off", async () => {
    render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    act(() => {
      chooseDynamics("mesh");
    });
    await loaded();
    act(() => {
      chooseDynamics("off");
    });
    await loaded();

    expect(calls).toEqual([
      "run flow",
      "show /api/covers/a",
      "stop",
      "run mesh",
      "show /api/covers/a",
      "stop",
    ]);
  });

  it("is still on a device asking for less motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    expect(calls[0]).toBe("run flow still");
  });

  it("runs nothing in a browser without WebGL 2, leaving the still blur", async () => {
    vi.stubGlobal("WebGL2RenderingContext", undefined);
    render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    expect(calls).toEqual([]);
  });

  it("stops when Now Playing closes", async () => {
    const { unmount } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    unmount();

    expect(calls.at(-1)).toBe("stop");
  });
});
