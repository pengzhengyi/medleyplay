import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { preloadWhenIdle } from "./lazyPart";
import { serve, signedIn, trackOf } from "./testing/server";
import { PRELOADED } from "./views/parts";

vi.mock("./lazyPart", async (importOriginal) => {
  const real = await importOriginal<typeof import("./lazyPart")>();
  return { ...real, preloadWhenIdle: vi.fn() };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(preloadWhenIdle).mockClear();
});

describe("the parts that load apart", () => {
  it("load while the browser is idle once the Library has drawn, not before", async () => {
    serve(signedIn([trackOf(1, "Night Drive")]));

    render(<App />);
    expect(preloadWhenIdle).not.toHaveBeenCalled();

    expect(await screen.findByRole("navigation", { name: "Views" })).toBeInTheDocument();
    await waitFor(() => {
      expect(preloadWhenIdle).toHaveBeenCalledWith(PRELOADED, expect.any(AbortSignal));
    });
  });
});
