import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";

import type { DownloadDiagnostics } from "../api";
import { downloadUnderWayOf, trackOf } from "../testing/server";
import { DownloadDetails } from "./DownloadDetails";
import { Downloading } from "./Downloading";

const trace: DownloadDiagnostics = {
  version: 1,
  job_id: 42,
  state: "failed",
  has_saved_audio: true,
  attempts: 1,
  max_attempts: 3,
  waits_for_online: false,
  retry_at: null,
  hold: "response_unknown",
  reason: "response_unknown",
  http_status: 567,
  events: [
    {
      sequence: 17,
      at: "2026-11-27T23:00:00Z",
      event: "dispatched",
      attempt: 1,
      route: "site_proxy",
      stage: null,
      part: null,
      reason: null,
      http_status: null,
      retry_at: null,
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

it("shows a held outcome and copies the private typed trace", async () => {
  const fetch = vi.fn(() => Promise.resolve(Response.json(trace)));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
  render(<DownloadDetails target={{ job: 42 }} close={vi.fn()} />);
  const dialog = within(screen.getByRole("dialog", { name: "Download details" }));

  await user.click(await dialog.findByRole("button", { name: "Copy diagnostics" }));

  expect(
    dialog.getByText("The provider returned unexplained HTTP 567. No retry scheduled."),
  ).toBeVisible();
  expect(dialog.getByRole("listitem")).toHaveTextContent("Site proxy (egress not measured)");
  expect(dialog.getByText("Saved audio available")).toBeVisible();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(trace, null, 2));
  expect(dialog.getByRole("status")).toHaveTextContent("Diagnostics copied.");
  expect(fetch.mock.calls).toHaveLength(1);
});

it("offers no copy action when access to the trace is denied", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(Response.json({}, { status: 404 }))),
  );
  render(<DownloadDetails target={{ job: 42 }} close={vi.fn()} />);

  expect(
    await screen.findByText("Only the requester or an admin can see this trace."),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: "Copy diagnostics" })).not.toBeInTheDocument();
});

it("keeps details open when the download finishes and its active row disappears", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ...trace, state: "running" }))
    .mockResolvedValueOnce(Response.json(trace));
  vi.stubGlobal("fetch", fetch);
  const user = userEvent.setup();
  const props = {
    tracks: [trackOf(1, "Night Drive")],
    accountId: 7,
    admin: false,
    cancelDownload: () => Promise.resolve(),
  };
  const { rerender } = render(
    <Downloading {...props} downloads={[downloadUnderWayOf(1, { id: 42, requested_by: 7 })]} />,
  );
  await user.click(screen.getByRole("button", { name: "Download actions for Night Drive" }));
  await user.click(await screen.findByRole("menuitem", { name: "Download details" }));
  const dialog = within(screen.getByRole("dialog", { name: "Download details" }));
  const refresh = await dialog.findByRole("button", { name: "Refresh details" });

  rerender(<Downloading {...props} downloads={[]} />);
  await user.click(refresh);

  expect(await dialog.findByText(/Download failed/)).toBeVisible();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});
