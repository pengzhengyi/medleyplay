import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { TrackDownload } from "../api";
import { downloadOf, trackOf } from "../testing/server";
import { AddFile } from "./AddFile";

const NIGHT_DRIVE = trackOf(3, "Night Drive", { site: "bilibili", download_failed: true });
const SONG = new File(["not really audio"], "night-drive.m4a", { type: "audio/mp4" });

type Upload = (
  trackId: number,
  file: File,
  onProgress: (sent: number, total: number) => void,
  signal: AbortSignal,
) => Promise<unknown>;

function renderDialog(
  state: TrackDownload = downloadOf(3, "failed", "Bilibili refused the login."),
  upload: Upload = () => Promise.resolve(state),
) {
  const load = vi.fn(() => Promise.resolve(state));
  const send = vi.fn(upload);
  const onAdded = vi.fn();
  const onClose = vi.fn();
  render(
    <AddFile track={NIGHT_DRIVE} load={load} upload={send} onAdded={onAdded} onClose={onClose} />,
  );
  return {
    send,
    onAdded,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Add the file for “Night Drive”" }),
  };
}

describe("adding a Track's file by hand", () => {
  it("says why the download failed, and lists the other ways with the part's link", async () => {
    const { dialog } = renderDialog();

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "The download failed: Bilibili refused the login.",
    );

    expect(within(dialog).getByRole("group")).toHaveAttribute("open");
    expect(
      within(dialog).getAllByText(/https:\/\/www\.bilibili\.com\/video\/BV1Xx41117Tz\?p=1/),
    ).not.toHaveLength(0);
  });

  it("explains a part the site no longer has", async () => {
    const { dialog } = renderDialog(
      downloadOf(3, "unavailable", "The site no longer has this video."),
    );

    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "The site no longer has this video.",
    );
  });

  it("will not add until a file is chosen", async () => {
    const { dialog } = renderDialog();
    await within(dialog).findByRole("status");

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.upload(within(dialog).getByLabelText("File"), SONG);
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("sends the file chosen, closes, and tells it was added", async () => {
    const { dialog, send, onAdded, onClose } = renderDialog();
    await userEvent.upload(within(dialog).getByLabelText("File"), SONG);

    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(send).toHaveBeenCalledExactlyOnceWith(
      3,
      SONG,
      expect.any(Function),
      expect.any(AbortSignal),
    );
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledOnce();
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows how far the upload has got while it goes", async () => {
    let report: (sent: number, total: number) => void = () => undefined;
    const { dialog } = renderDialog(undefined, (_id, _file, onProgress) => {
      report = onProgress;
      return new Promise(() => undefined);
    });
    await userEvent.upload(within(dialog).getByLabelText("File"), SONG);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    report(4, 16);

    const bar = await within(dialog).findByRole("progressbar", { name: "Upload progress" });
    expect(bar).toHaveAttribute("value", "4");
    expect(bar).toHaveAttribute("max", "16");
    expect(within(dialog).getByText("25% of 16 bytes")).toBeVisible();
    expect(within(dialog).getByLabelText("File")).toBeDisabled();
  });

  it("stops the upload when it is cancelled", async () => {
    let signal: AbortSignal | undefined;
    const { dialog, onAdded } = renderDialog(undefined, (_id, _file, _progress, stopped) => {
      signal = stopped;
      return new Promise(() => undefined);
    });
    await userEvent.upload(within(dialog).getByLabelText("File"), SONG);
    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(signal?.aborted).toBe(true);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it("says why the server refused the file, and lets another be chosen", async () => {
    const { dialog, onClose } = renderDialog(undefined, () =>
      Promise.reject(new Error("medleyplay can't read this file as audio with a length.")),
    );
    await userEvent.upload(within(dialog).getByLabelText("File"), SONG);

    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("can't read this file");
    expect(within(dialog).getByLabelText("File")).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
