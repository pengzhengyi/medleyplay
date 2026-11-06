import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListenOnDevice } from "./ListenOnDevice";

/** This page, opened on the server's own machine. */
const ON_THIS_MACHINE = { protocol: "http:", hostname: "localhost", port: "8000" };

/** Open the guide for Alice, the server answering on the network at `addresses`. */
async function open(addresses: readonly string[]) {
  render(
    <ListenOnDevice
      username="alice"
      load={() => Promise.resolve({ addresses })}
      here={ON_THIS_MACHINE}
      onClose={vi.fn()}
    />,
  );
  const dialog = screen.getByRole("dialog", { name: "Listen on your device" });
  await within(dialog).findByText(/Join the same Wi-Fi|can't reach this computer/u);
  return dialog;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listening on another device", () => {
  it("shows the server's surest address as a code to scan and as text, and who signs in", async () => {
    const dialog = await open(["192.168.1.20", "mac-mini.local"]);

    expect(
      within(dialog).getByRole("img", { name: "QR code of http://192.168.1.20:8000" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("http://192.168.1.20:8000")).toBeInTheDocument();
    expect(within(dialog).getByText("alice")).toBeInTheDocument();
  });

  it("shows another address when it is chosen", async () => {
    const dialog = await open(["192.168.1.20", "mac-mini.local"]);

    await userEvent.click(within(dialog).getByRole("button", { name: "mac-mini.local:8000" }));

    expect(
      within(dialog).getByRole("img", { name: "QR code of http://mac-mini.local:8000" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "mac-mini.local:8000" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("offers no choice of address when there is one", async () => {
    const dialog = await open(["192.168.1.20"]);

    expect(within(dialog).queryByRole("list", { name: "Addresses" })).toBeNull();
  });

  it("copies the address and says so beside it", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const dialog = await open(["192.168.1.20"]);

    await userEvent.click(
      within(dialog).getByRole("button", { name: "Copy http://192.168.1.20:8000" }),
    );

    expect(writeText).toHaveBeenCalledExactlyOnceWith("http://192.168.1.20:8000");
    expect(await within(dialog).findByText("Copied")).toHaveRole("status");
  });

  it("says how to make the computer reachable when no other device can reach it", async () => {
    const dialog = await open([]);

    expect(within(dialog).getByText(/Connect it to the same Wi-Fi as your phone/u)).toBeVisible();
    expect(within(dialog).queryByRole("img")).toBeNull();
  });
});
