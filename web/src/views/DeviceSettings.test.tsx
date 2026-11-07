import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AllowedDevice, Devices } from "../api";
import { type Routes, serve } from "../testing/server";
import { DeviceSettings } from "./DeviceSettings";

const NOW = "2026-11-07T18:00:00Z";

function allowedOf(id: string, label: string, change: Partial<AllowedDevice> = {}): AllowedDevice {
  return {
    id,
    label,
    address: "192.168.1.23",
    allowed_at: NOW,
    last_seen_at: NOW,
    this_device: false,
    ...change,
  };
}

/** Asking first; this Mac, an iPhone, and an iPad allowed; a laptop waiting with code 0917. */
const HOUSEHOLD: Devices = {
  admission: "ask",
  revision: 3,
  waiting: [
    {
      id: "fedcba9876543210",
      label: "Chrome on Windows",
      address: "192.168.1.40",
      code: "0917",
      since: NOW,
    },
  ],
  allowed: [
    allowedOf("aaaaaaaaaaaaaaaa", "Safari on Mac", { this_device: true }),
    allowedOf("bbbbbbbbbbbbbbbb", "Safari on iPhone"),
    allowedOf("cccccccccccccccc", "Safari on iPad", { address: "192.168.1.24" }),
  ],
};

function open(routes: Routes = {}) {
  const served = serve({ "GET /api/devices": { body: HOUSEHOLD }, ...routes });
  render(<DeviceSettings waiting={HOUSEHOLD.waiting} />);
  return served;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeviceSettings", () => {
  it("shows the choice for new devices", async () => {
    open();

    expect(await screen.findByRole("radio", { name: /^Ask first/ })).toBeChecked();
  });

  it("saves another choice at the revision read", async () => {
    const saved: unknown[] = [];
    open({
      "PUT /api/devices/setting": (body) => {
        saved.push(body);
        return { body: { ...HOUSEHOLD, admission: "known", revision: 4 } };
      },
    });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("radio", { name: /^Block new devices/ }));

    expect(saved).toEqual([{ admission: "known", revision: 3 }]);
    expect(screen.getByRole("radio", { name: /^Block new devices/ })).toBeChecked();
  });

  it("tags this device and offers no way to remove it", async () => {
    open();

    const allowed = await screen.findByRole("list", { name: "Allowed devices" });
    const mine = within(allowed).getByText("This device").closest("li");

    expect(mine).not.toBeNull();
    expect(within(mine as HTMLElement).queryByRole("button")).not.toBeInTheDocument();
  });

  it("removes one allowed device", async () => {
    const { calls } = open({ "DELETE /api/devices/bbbbbbbbbbbbbbbb": { status: 204 } });
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Remove Safari on iPhone at 192.168.1.23" }),
    );

    expect(calls).toContain("DELETE /api/devices/bbbbbbbbbbbbbbbb");
    expect(await screen.findByText("Removed.")).toBeInTheDocument();
  });

  it("asks once more before removing all the other devices", async () => {
    const { calls } = open({ "DELETE /api/devices": { status: 204 } });
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Remove all" }));
    const asking = screen.getByRole("group", { name: "Remove all devices" });
    const removedBeforeAnswering = calls.includes("DELETE /api/devices");
    await user.click(within(asking).getByRole("button", { name: "Remove all" }));

    expect(asking).toHaveTextContent("Remove 2 devices?");
    expect(removedBeforeAnswering).toBe(false);
    expect(calls).toContain("DELETE /api/devices");
  });

  it("answers a waiting device from its row", async () => {
    const { calls } = open({ "POST /api/devices/fedcba9876543210/allow": { body: {} } });
    const user = userEvent.setup();

    const waiting = await screen.findByRole("list", { name: "Waiting devices" });
    await user.click(within(waiting).getByRole("button", { name: "Allow" }));

    expect(within(waiting).getByText(/code/)).toHaveTextContent("192.168.1.40 · code 0917");
    expect(calls).toContain("POST /api/devices/fedcba9876543210/allow");
  });
});
