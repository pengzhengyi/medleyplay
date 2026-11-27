import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { chooseDynamics } from "../dynamics";
import { Dynamics } from "./Dynamics";
import { coverBackdrop } from "./dynamics/coverMotion";

/** What the renderer was asked to do, in order. */
const calls: string[] = [];
let drawn: ((drawn: boolean) => void) | undefined;
let slow: (() => void) | undefined;

vi.mock("./dynamics/coverMotion", () => ({ coverBackdrop: vi.fn() }));

vi.mock("./dynamics/renderer", () => ({
  run: (
    _host: HTMLElement,
    {
      still,
      onDrawn,
      onSlow,
    }: { still: boolean; onDrawn: (drawn: boolean) => void; onSlow: () => void },
  ) => {
    calls.push(`run mesh${still ? " still" : ""}`);
    drawn = onDrawn;
    slow = onSlow;
    return {
      show: (url: string | null) => calls.push(`show ${String(url)}`),
      stop: () => calls.push("stop"),
    };
  },
}));

/** Let the renderer module load, as it does on first use. */
const loaded = () => act(() => vi.dynamicImportSettled());

beforeEach(() => {
  chooseDynamics("mesh");
  calls.length = 0;
  drawn = undefined;
  slow = undefined;
  vi.mocked(coverBackdrop).mockReset();
  vi.mocked(coverBackdrop).mockResolvedValue({ colors: ["#421225", "#11213e"] });
  // jsdom draws nothing, so these tests stand in a browser with WebGL 2.
  vi.stubGlobal("WebGL2RenderingContext", vi.fn());
});

afterEach(() => {
  chooseDynamics("flow");
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Dynamics behind Now Playing", () => {
  it("uses the current CSS backdrop even if an earlier cover finishes later", async () => {
    chooseDynamics("flow");
    let finishOld: (result: Awaited<ReturnType<typeof coverBackdrop>>) => void = () => undefined;
    const old = new Promise<Awaited<ReturnType<typeof coverBackdrop>>>((resolve) => {
      finishOld = resolve;
    });
    vi.mocked(coverBackdrop).mockReturnValueOnce(old);
    const { container, rerender } = render(<Dynamics cover="/api/covers/a" />);
    rerender(<Dynamics cover="/api/covers/b" />);
    const layer = () => container.querySelector(".np-cover-motion-layer");
    await waitFor(() => {
      expect(layer()).toHaveStyle("--np-cover-a: #421225");
    });

    await act(async () => {
      finishOld({ colors: ["#000000", "#000000"] });
      await old;
    });

    expect(layer()).toHaveStyle("--np-cover-a: #421225");
    expect(calls).toEqual([]);
    rerender(<Dynamics cover={null} />);
    expect(layer()).toBeNull();
  });

  it("leaves the still background when CSS cover preparation fails", async () => {
    chooseDynamics("drift");
    vi.mocked(coverBackdrop).mockRejectedValueOnce(new Error("Cannot decode"));
    const { container } = render(<Dynamics cover="/api/covers/a" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector(".np-cover-motion")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("runs the effect chosen over the cover, and fades in once drawn", async () => {
    const { container } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();
    const layer = container.querySelector(".np-dynamics");
    const before = layer?.className;

    act(() => drawn?.(true));

    expect(calls).toEqual(["run mesh", "show /api/covers/a"]);
    expect(before).toBe("np-dynamics");
    expect(layer).toHaveClass("np-dynamics-drawn");
  });

  it("follows the cover as the song changes", async () => {
    const { rerender } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    rerender(<Dynamics cover="/api/covers/b" />);

    expect(calls).toEqual(["run mesh", "show /api/covers/a", "show /api/covers/b"]);
  });

  it("stops Mesh when switching to Soft Pan and does not start WebGL for either CSS effect", async () => {
    render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    act(() => {
      chooseDynamics("drift");
    });
    await loaded();
    act(() => {
      chooseDynamics("flow");
    });
    await loaded();

    expect(calls).toEqual(["run mesh", "show /api/covers/a", "stop"]);
  });

  it("is still on a device asking for less motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    expect(calls[0]).toBe("run mesh still");
  });

  it("runs nothing in a browser without WebGL 2, leaving the still blur", async () => {
    vi.stubGlobal("WebGL2RenderingContext", undefined);
    render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    expect(calls).toEqual([]);
  });

  it("keeps the light fallback after the cover changes or reduced motion is toggled", async () => {
    const motion = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", () => motion);
    const { container, rerender } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();
    const layer = container.querySelector(".np-dynamics");
    const lateDraw = drawn;

    act(() => slow?.());
    rerender(<Dynamics cover="/api/covers/b" />);
    act(() => lateDraw?.(true));
    act(() => {
      motion.matches = true;
      motion.dispatchEvent(new Event("change"));
    });
    await loaded();
    expect(layer).not.toHaveClass("np-dynamics-slow");
    act(() => {
      motion.matches = false;
      motion.dispatchEvent(new Event("change"));
    });
    await loaded();

    expect(layer).toHaveClass("np-dynamics-slow");
    expect(layer).not.toHaveClass("np-dynamics-drawn");
    expect(calls).toEqual(["run mesh", "show /api/covers/a", "stop"]);
  });

  it("pauses fallback motion when hidden and tries WebGL again after a different effect is chosen", async () => {
    let hidden = false;
    const visibility = vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
    try {
      const { container } = render(<Dynamics cover="/api/covers/a" />);
      await loaded();
      const layer = container.querySelector(".np-dynamics");
      act(() => slow?.());

      act(() => {
        hidden = true;
        document.dispatchEvent(new Event("visibilitychange"));
      });

      expect(layer).toHaveAttribute("data-paused", "true");
      act(() => {
        hidden = false;
        document.dispatchEvent(new Event("visibilitychange"));
        chooseDynamics("off");
      });
      await loaded();
      act(() => {
        chooseDynamics("mesh");
      });
      await loaded();

      const restarted = container.querySelector(".np-dynamics");
      expect(restarted).not.toHaveAttribute("data-paused");
      expect(restarted).not.toHaveClass("np-dynamics-slow");
      expect(calls.slice(-2)).toEqual(["run mesh", "show /api/covers/a"]);
    } finally {
      visibility.mockRestore();
    }
  });

  it("stops when Now Playing closes", async () => {
    const { unmount } = render(<Dynamics cover="/api/covers/a" />);
    await loaded();

    unmount();

    expect(calls.at(-1)).toBe("stop");
  });
});
