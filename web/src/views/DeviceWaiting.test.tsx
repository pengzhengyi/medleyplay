import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeviceInfo } from "../api";
import { serve } from "../testing/server";
import { ASK_AGAIN_MS, DeviceWaiting } from "./DeviceWaiting";

const WAITING: DeviceInfo = { presence: "waiting", label: "Safari on iPhone", code: "4821" };
const REFUSED: DeviceInfo = { presence: "refused", label: "Safari on iPhone", code: null };
const ALLOWED: DeviceInfo = { presence: "allowed", label: "Safari on iPhone", code: null };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DeviceWaiting", () => {
  it("shows a waiting device's code, large, to match against the admin's screen", () => {
    serve({});

    render(<DeviceWaiting device={WAITING} onAnswered={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(screen.getByLabelText("Code 4821")).toHaveTextContent("4821");
    expect(screen.getByText(/next to Safari on iPhone/)).toBeInTheDocument();
  });

  it("asks again every few seconds and tells the answer", async () => {
    vi.useFakeTimers();
    const { calls } = serve({ "GET /api/device": { body: ALLOWED } });
    const onAnswered = vi.fn();
    render(<DeviceWaiting device={WAITING} onAnswered={onAnswered} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS);
    });

    expect(calls).toEqual(["GET /api/device"]);
    expect(onAnswered).toHaveBeenCalledWith(ALLOWED);
  });

  it("says a refused device can't connect, and asks again only when told", async () => {
    const { calls } = serve({ "GET /api/device": { body: REFUSED } });
    const onAnswered = vi.fn();
    render(<DeviceWaiting device={REFUSED} onAnswered={onAnswered} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Ask again" }));

    expect(screen.getByRole("heading", { name: "This device can't connect" })).toBeInTheDocument();
    expect(calls).toEqual(["GET /api/device"]);
    expect(onAnswered).toHaveBeenCalledWith(REFUSED);
  });
});
