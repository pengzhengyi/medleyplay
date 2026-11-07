import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WaitingDevice } from "../api";
import { serve } from "../testing/server";
import { WaitingDevices } from "./WaitingDevices";

/** Safari on Mia's iPhone, waiting with code 4821. */
const IPHONE: WaitingDevice = {
  id: "0123456789abcdef",
  label: "Safari on iPhone",
  address: "192.168.1.23",
  code: "4821",
  since: "2026-11-07T18:00:00Z",
};
/** Chrome on a laptop, waiting with code 0917. */
const LAPTOP: WaitingDevice = {
  id: "fedcba9876543210",
  label: "Chrome on Windows",
  address: "192.168.1.40",
  code: "0917",
  since: "2026-11-07T18:01:00Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WaitingDevices", () => {
  it("shows nothing while no device waits", () => {
    const { container } = render(<WaitingDevices waiting={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("lists each waiting device with its address and code", async () => {
    render(<WaitingDevices waiting={[IPHONE, LAPTOP]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "2 devices waiting" }));

    expect(screen.getByRole("group", { name: "Safari on iPhone, code 4821" })).toHaveTextContent(
      "192.168.1.23 · code 4821",
    );
    expect(screen.getByRole("group", { name: "Chrome on Windows, code 0917" })).toBeInTheDocument();
  });

  it("allows the device chosen", async () => {
    const { calls } = serve({
      "POST /api/devices/0123456789abcdef/allow": { body: {} },
    });
    render(<WaitingDevices waiting={[IPHONE]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "1 device waiting" }));
    await user.click(screen.getByRole("menuitem", { name: "Allow" }));

    expect(calls).toEqual(["POST /api/devices/0123456789abcdef/allow"]);
  });

  it("says beside the pill why an answer failed", async () => {
    serve({
      "POST /api/devices/0123456789abcdef/turn-away": {
        status: 404,
        body: { detail: "That device is no longer waiting; it may have stopped asking." },
      },
    });
    render(<WaitingDevices waiting={[IPHONE]} />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "1 device waiting" }));
    await user.click(screen.getByRole("menuitem", { name: "Turn away" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("no longer waiting");
  });
});
