import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import type { Devices } from "../api";
import { FakeEventSource, stream } from "../testing/events";
import { ALICE, serve, signedIn, speakerStateOf, trackOf } from "../testing/server";

const SONG = trackOf(1, "Lemon");
const WAITING = {
  id: "fedcba9876543210",
  label: "Safari on iPhone",
  address: "192.168.4.42",
  code: "4821",
  since: "2026-11-27T18:00:00Z",
};

async function openDevices(section: "Listen on another device" | "Playback mode") {
  await userEvent.click(await screen.findByRole("button", { name: "Devices" }));
  await screen.findByRole(section === "Playback mode" ? "group" : "region", { name: section });
  return within(await screen.findByRole("dialog", { name: "Devices" }));
}

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

describe("the device window", () => {
  it("allows, renames, and removes a device in place, even when sharing is off", async () => {
    let house: Devices = { admission: "ask", revision: 1, waiting: [WAITING], allowed: [] };
    const allowed = {
      id: WAITING.id,
      label: WAITING.label,
      name: null,
      address: WAITING.address,
      allowed_at: WAITING.since,
      last_seen_at: WAITING.since,
      this_device: false,
    };
    serve({
      ...signedIn([SONG]),
      "GET /api/addresses": { body: { addresses: [], share_url: null } },
      "GET /api/devices": () => ({ body: house }),
      [`POST /api/devices/${WAITING.id}/allow`]: () => {
        house = { ...house, waiting: [], allowed: [allowed] };
        return { body: allowed };
      },
      [`PUT /api/devices/${WAITING.id}/name`]: () => {
        const named = { ...allowed, name: "Kitchen phone" };
        house = { ...house, allowed: [named] };
        return { body: named };
      },
      [`DELETE /api/devices/${WAITING.id}`]: () => {
        house = { ...house, allowed: [] };
        return { status: 204 };
      },
    });
    render(<App />);
    const dialog = await openDevices("Listen on another device");
    const user = userEvent.setup();
    expect(await dialog.findByText("LAN sharing is off. Start it from Terminal.")).toBeVisible();
    expect(await dialog.findByText("4821")).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Allow" }));

    await user.click(await dialog.findByRole("button", { name: "Rename Safari on iPhone" }));
    await user.type(
      dialog.getByRole("textbox", { name: "Name of Safari on iPhone" }),
      "Kitchen phone",
    );
    await user.click(dialog.getByRole("button", { name: "Save" }));
    await user.click(await dialog.findByRole("button", { name: /^Remove Kitchen phone/u }));

    expect(await dialog.findByText("No devices yet.")).toBeVisible();
    expect(dialog.queryByRole("link", { name: "Open Devices settings" })).toBeNull();
  });

  it("gives a LAN member modes and current connection information without reading the admin list", async () => {
    const { calls } = serve({
      ...signedIn([SONG]),
      "GET /api/me": { body: { ...ALICE, role: "member" } },
      "GET /api/device": { body: { presence: "allowed", label: WAITING.label, code: null } },
    });
    render(<App />);
    const dialog = await openDevices("Playback mode");

    expect(await dialog.findByRole("radio", { name: /^Client/u })).toBeChecked();
    expect(dialog.getByRole("radio", { name: /^Remote/u })).toBeDisabled();
    const connection = within(dialog.getByRole("region", { name: "Connection info" }));
    expect(connection.getByText(location.origin)).toBeVisible();
    expect(connection.getByText("Connecting")).toBeVisible();

    act(() => {
      stream().send("ready");
      stream().send("remote", { page: "host-page-0001", state: speakerStateOf(), age_ms: 0 });
    });
    await userEvent.click(dialog.getByRole("radio", { name: /^Remote/u }));
    expect(dialog.getByRole("radio", { name: /^Remote/u })).toBeChecked();
    expect(connection.getByText("Connected")).toBeVisible();

    act(() => {
      stream().send("error");
    });
    expect(connection.getByText("Reconnecting")).toBeVisible();
    expect(dialog.getByRole("radio", { name: /^Remote/u })).toBeChecked();
    expect(dialog.queryByText("Manage devices")).toBeNull();
    expect(calls).not.toContain("GET /api/devices");
    expect(calls).not.toContain("GET /api/addresses");
    expect(calls).not.toContain("POST /api/remote/commands");
  });

  it("leaves Client usable when the server could not classify the connection", async () => {
    const { calls } = serve({
      ...signedIn([SONG]),
      "GET /api/me": { body: { ...ALICE, role: "member" } },
      "GET /api/device": { status: 503 },
    });
    render(<App />);
    const dialog = await openDevices("Playback mode");

    expect(dialog.getByRole("radio", { name: /^Client/u })).toBeEnabled();
    expect(dialog.getByRole("radio", { name: /^Remote/u })).toBeDisabled();
    expect(dialog.getByText("Device connection type is unknown.")).toBeVisible();
    expect(dialog.getByText(location.origin)).toBeVisible();
    expect(calls).not.toContain("GET /api/addresses");
  });
});
