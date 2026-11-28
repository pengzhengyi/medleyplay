import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ListenOnDevice } from "./ListenOnDevice";
import { LanguageSelect } from "./LanguageSelect";

/** This page, opened on the server's own machine. */
const ON_THIS_MACHINE = { protocol: "http:", hostname: "localhost", port: "8000" };

/** Open the guide for Alice, the server answering on the network at `addresses`. */
async function open(addresses: readonly string[], here = ON_THIS_MACHINE) {
  render(
    <ListenOnDevice username="alice" load={() => Promise.resolve({ addresses })} here={here} />,
  );
  const dialog = screen.getByRole("region", { name: "Listen on another device" });
  await within(dialog).findByText(/Join the same Wi-Fi|No local network address/u);
  return dialog;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listening on another device", () => {
  it("uses the managed sharing URL instead of the host browser port", async () => {
    render(
      <ListenOnDevice
        username="alice"
        load={() => Promise.resolve({ addresses: [], share_url: "http://192.168.1.20:8123" })}
        here={ON_THIS_MACHINE}
      />,
    );

    expect(
      await screen.findByRole("img", { name: "QR code of http://192.168.1.20:8123" }),
    ).toBeVisible();
    expect(screen.getByText("8123")).toBeVisible();
  });

  it("does not advertise a link while managed LAN sharing is off", async () => {
    render(
      <ListenOnDevice
        username="alice"
        load={() => Promise.resolve({ addresses: [], share_url: null })}
        here={{ ...ON_THIS_MACHINE, hostname: "music.home" }}
      />,
    );

    expect(await screen.findByText("LAN sharing is off. Start it from Terminal.")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("removes the QR code when sharing stops while the dialog is open", async () => {
    vi.useFakeTimers();
    try {
      const load = vi
        .fn<() => Promise<{ addresses: string[]; share_url: string | null }>>()
        .mockResolvedValueOnce({ addresses: [], share_url: "http://192.168.1.20:8123" })
        .mockResolvedValue({ addresses: [], share_url: null });
      render(<ListenOnDevice username="alice" load={load} here={ON_THIS_MACHINE} />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        screen.getByRole("img", { name: "QR code of http://192.168.1.20:8123" }),
      ).toBeVisible();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });

      expect(screen.queryByRole("img")).not.toBeInTheDocument();
      expect(screen.getByText("LAN sharing is off. Start it from Terminal.")).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it("translates the setup instructions without changing the address or account name", async () => {
    render(<LanguageSelect />);
    const language = screen.getByRole("combobox", { name: "Language" });
    const dialog = await open(["192.168.1.20"]);

    try {
      fireEvent.change(language, { target: { value: "zh-Hans" } });

      const guide = within(dialog);
      expect(dialog).toHaveAccessibleName("在其他设备上收听");
      expect(guide.getByText("连接到与这台电脑相同的 Wi-Fi。")).toBeVisible();
      expect(guide.getByRole("region", { name: "连接信息" })).toHaveTextContent("协议HTTP");
      expect(guide.getByRole("img", { name: "http://192.168.1.20:8000 的二维码" })).toBeVisible();
      expect(guide.getByText("alice", { selector: "strong" })).toBeVisible();
      expect(guide.getByText(/让此电脑保持开机并连接网络/u)).toBeVisible();
    } finally {
      fireEvent.change(language, { target: { value: "auto" } });
    }
  });

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
    const connection = within(within(dialog).getByRole("region", { name: "Connection info" }));
    expect(connection.getByText("http://192.168.1.20:8000")).toBeVisible();
    expect(connection.getByText("HTTP")).toBeVisible();
    expect(connection.getByText("8000")).toBeVisible();
    expect(connection.getByText(/does not verify access from another device/u)).toBeVisible();

    await userEvent.click(within(dialog).getByRole("button", { name: "mac-mini.local:8000" }));

    expect(
      within(dialog).getByRole("img", { name: "QR code of http://mac-mini.local:8000" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "mac-mini.local:8000" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(connection.getByText("http://mac-mini.local:8000")).toBeVisible();
  });

  it("shows the effective port for a secure share URL without an explicit port", async () => {
    const dialog = await open([], { protocol: "https:", hostname: "music.example", port: "" });

    const connection = within(within(dialog).getByRole("region", { name: "Connection info" }));
    expect(connection.getByText("https://music.example")).toBeVisible();
    expect(connection.getByText("HTTPS")).toBeVisible();
    expect(connection.getByText("443")).toBeVisible();
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

  it("says what to check when no address is found without claiming the server is unreachable", async () => {
    const dialog = await open([]);

    expect(
      within(dialog).getByText(
        /If medleyplay started before the connection was available, restart it/u,
      ),
    ).toBeVisible();
    expect(within(dialog).getByText(/No local network address was found/u)).toBeVisible();
    expect(within(dialog).queryByRole("img")).toBeNull();
    await userEvent.click(within(dialog).getByText("Can't connect?"));
    expect(within(dialog).getByText(/If the page does not load/u)).toBeVisible();
    expect(within(dialog).getByText(/If the device is waiting for approval/u)).toBeVisible();
  });
});
