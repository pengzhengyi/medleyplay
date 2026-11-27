import { afterEach, expect, it, vi } from "vitest";

import { run } from "./renderer";

const render = vi.fn();
const resize = vi.fn();

vi.mock("ogl", () => ({
  Renderer: class {
    readonly isWebgl2 = true;
    readonly gl = { canvas: document.createElement("canvas"), getExtension: () => null };
    readonly render = render;
    readonly setSize = resize;
  },
  Texture: vi.fn(function () {
    return {};
  }),
  Program: vi.fn(function () {
    return {};
  }),
  Mesh: vi.fn(function () {
    return {};
  }),
  Triangle: vi.fn(function () {
    return {};
  }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("stops drawing after sustained slow frames even when resize and image decode complete", async () => {
  let resizeObserved = () => undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(observed: () => undefined) {
        resizeObserved = observed;
      }
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();
    },
  );
  const first = Promise.resolve();
  let finishLate: () => void = () => undefined;
  const late = new Promise<void>((resolve) => {
    finishLate = resolve;
  });
  const decode = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(late);
  vi.stubGlobal(
    "Image",
    class {
      readonly decode = decode;
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    getImageData: () => ({ data: new Uint8ClampedArray([80, 120, 160, 255]) }),
  } as unknown as CanvasRenderingContext2D);
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (draw: FrameRequestCallback) => {
    frame = draw;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frame = undefined;
  });

  const host = document.createElement("div");
  const onDrawn = vi.fn();
  const onSlow = vi.fn(() => {
    running.stop();
  });
  const running = run(host, "flow", { still: false, onDrawn, onSlow });
  running.show("/cover-a");
  await first;
  running.show("/cover-b");

  for (let index = 0; index <= 16; index++) frame?.(index * 83);
  const draws = render.mock.calls.length;
  const sizes = resize.mock.calls.length;
  resizeObserved();
  finishLate();
  await late;

  expect(onSlow).toHaveBeenCalledOnce();
  expect(onDrawn).toHaveBeenCalledExactlyOnceWith(true);
  expect(render).toHaveBeenCalledTimes(draws);
  expect(resize).toHaveBeenCalledTimes(sizes);
  expect(frame).toBeUndefined();
  expect(host.querySelector("canvas")).toBeNull();
});
