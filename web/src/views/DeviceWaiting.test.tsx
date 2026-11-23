import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeviceInfo } from "../api";
import { ASK_AGAIN_MS, DeviceWaiting } from "./DeviceWaiting";

const WAITING: DeviceInfo = { presence: "waiting", label: "Safari on iPhone", code: "4821" };
const REFUSED: DeviceInfo = { presence: "refused", label: "Safari on iPhone", code: null };

afterEach(() => {
  vi.useRealTimers();
});

describe("DeviceWaiting", () => {
  it("shows a waiting device's code, large, to match against the admin's screen", () => {
    render(<DeviceWaiting device={WAITING} onCheck={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(screen.getByLabelText("Code 4821")).toHaveTextContent("4821");
    expect(screen.getByText(/next to Safari on iPhone/)).toBeInTheDocument();
  });

  it("checks again every few seconds while waiting", async () => {
    vi.useFakeTimers();
    const onCheck = vi.fn();
    render(<DeviceWaiting device={WAITING} onCheck={onCheck} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS);
    });

    expect(onCheck).toHaveBeenCalledOnce();
  });

  it("says a refused device can't connect, and asks again only when told", async () => {
    const onCheck = vi.fn();
    render(<DeviceWaiting device={REFUSED} onCheck={onCheck} />);
    const user = userEvent.setup();

    expect(onCheck).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Ask again" }));

    expect(screen.getByRole("heading", { name: "This device can't connect" })).toBeInTheDocument();
    expect(onCheck).toHaveBeenCalledOnce();
  });
});
