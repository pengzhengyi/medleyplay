import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { api } from "./api";
import { ASK_AGAIN_MS } from "./views/DeviceWaiting";
import { LanguageSelect } from "./views/LanguageSelect";
import { ALICE, enricherOf, modeOf, serve, signedIn, trackOf } from "./testing/server";

/** The rail of views, where who is signed in sits on a laptop. */
const rail = () => within(screen.getByRole("navigation", { name: "Views" }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("links to GitHub at the right end of the header after keyboard shortcuts", async () => {
    serve(signedIn([]));
    render(<App />);

    const github = await screen.findByRole("link", {
      name: "View medleyplay on GitHub (opens in a new tab)",
    });
    const header = screen.getAllByRole("banner").find((banner) => banner.contains(github));
    if (header === undefined) throw new Error("GitHub link is not in the header");
    const shortcuts = within(header).getByRole("button", { name: "Keyboard shortcuts" });

    expect(github).toHaveAttribute("href", "https://github.com/pengzhengyi/medleyplay");
    expect(github).toHaveAttribute("target", "_blank");
    expect(github).toHaveAttribute("rel", "noopener noreferrer");
    expect(github).toHaveAttribute("title", "View medleyplay on GitHub (opens in a new tab)");
    expect(header.lastElementChild).toBe(github);
    expect(shortcuts.compareDocumentPosition(github) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(
      0,
    );

    within(header).getByRole("button", { name: "Alice: account" }).focus();
    await userEvent.tab();

    expect(github).toHaveFocus();
  });

  it("translates the GitHub link name and tooltip when the device language changes", async () => {
    serve(signedIn([]));
    render(
      <>
        <App />
        <LanguageSelect />
      </>,
    );
    const language = screen.getByRole("combobox", { name: "Language" });

    await userEvent.selectOptions(language, "zh-Hans");
    try {
      const github = await screen.findByRole("link", {
        name: "在 GitHub 上查看 medleyplay（在新标签页中打开）",
      });
      expect(github).toHaveAttribute("title", "在 GitHub 上查看 medleyplay（在新标签页中打开）");
    } finally {
      await userEvent.selectOptions(language, "auto");
    }
  });

  it("uses the early device request once in Strict Mode before signing an admitted device in", async () => {
    let admit: () => void = () => undefined;
    const admission = new Promise<void>((resolve) => {
      admit = resolve;
    });
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/device": {
        body: { presence: "admitted", label: "Safari on iPhone", code: null },
        after: admission,
      },
    });
    const device = fetch("/api/device");

    vi.stubGlobal("medleyplayFirstReads", { device });
    render(<App />, { reactStrictMode: true });

    expect(calls).toEqual(["GET /api/device"]);
    admit();
    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/device" || call === "GET /api/me")).toEqual([
      "GET /api/device",
      "GET /api/me",
    ]);
  });

  it("does not read the account or tracks when the early device check refuses admission", async () => {
    const { calls } = serve({
      "GET /api/device": {
        body: { presence: "refused", label: "Safari on iPhone", code: null },
      },
    });
    const device = fetch("/api/device");

    vi.stubGlobal("medleyplayFirstReads", { device });
    render(<App />);

    expect(await screen.findByText(/can't connect/u)).toBeVisible();
    expect(calls.filter((call) => /^GET \/api\/(device|me|tracks)$/u.test(call))).toEqual([
      "GET /api/device",
    ]);
  });

  it("falls back to the account when the early device request fails", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/device": { status: 503 },
    });
    const device = fetch("/api/device");

    vi.stubGlobal("medleyplayFirstReads", { device });
    render(<App />);

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/device")).toHaveLength(1);
  });

  it("uses an account response already received before the app mounted", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/device": { body: { presence: "host", label: "Local browser", code: null } },
    });
    const device = Promise.resolve(await fetch("/api/device"));
    const account = Promise.resolve(await fetch("/api/me"));

    vi.stubGlobal("medleyplayFirstReads", { device, account });
    render(<App />, { reactStrictMode: true });

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/me")).toHaveLength(1);
  });

  it("rechecks admission when an early account response says the device was removed", async () => {
    let removed = false;
    const { calls } = serve({
      "GET /api/device": () => ({
        body: removed
          ? { presence: "waiting", label: "Safari on iPhone", code: "0042" }
          : { presence: "allowed", label: "Safari on iPhone", code: null },
      }),
      "GET /api/me": {
        status: 403,
        body: { detail: "This device is waiting for approval.", code: "device_waiting" },
      },
    });
    const device = Promise.resolve(await fetch("/api/device"));
    removed = true;
    const account = Promise.resolve(await fetch("/api/me"));

    vi.stubGlobal("medleyplayFirstReads", { device, account });
    render(<App />);

    expect(await screen.findByLabelText("Code 0042")).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/device" || call === "GET /api/me")).toEqual([
      "GET /api/device",
      "GET /api/me",
      "GET /api/device",
    ]);
    expect(calls).not.toContain("GET /api/tracks");
    expect(calls).not.toContain("GET /api/setup");
  });

  it("does not restore the Library when an old account read finishes after device refusal", async () => {
    let removed = false;
    let answerAccount: (response: Response) => void = () => undefined;
    const account = new Promise<Response>((resolve) => {
      answerAccount = resolve;
    });
    const { calls } = serve({
      "GET /api/device": () => ({
        body: removed
          ? { presence: "waiting", label: "Safari on iPhone", code: "0042" }
          : { presence: "allowed", label: "Safari on iPhone", code: null },
      }),
      "GET /api/tracks": {
        status: 403,
        body: { detail: "This device is waiting for approval.", code: "device_waiting" },
      },
    });
    const device = Promise.resolve(await fetch("/api/device"));
    vi.stubGlobal("medleyplayFirstReads", { device, account });
    render(<App />);
    removed = true;

    await api.tracks().catch(() => undefined);
    expect(await screen.findByLabelText("Code 0042")).toBeVisible();
    await act(async () => {
      answerAccount(Response.json(ALICE));
      await account;
    });

    expect(screen.getByLabelText("Code 0042")).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/tracks")).toHaveLength(1);
  });

  it("reads a fresh session after the root is remounted", async () => {
    let signedInNow = false;
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/device": { body: { presence: "host", label: "Local browser", code: null } },
      "GET /api/me": () => (signedInNow ? { body: ALICE } : { status: 401 }),
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    const device = Promise.resolve(await fetch("/api/device"));
    const account = Promise.resolve(await fetch("/api/me"));
    vi.stubGlobal("medleyplayFirstReads", { device, account });
    const first = render(<App />);
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/me")).toHaveLength(1);
    first.unmount();

    signedInNow = true;
    render(<App />);

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeVisible();
    expect(calls.filter((call) => call === "GET /api/me")).toHaveLength(2);
  });

  it("keeps a newer admission check when an earlier Ask again response arrives late", async () => {
    let releaseEarlier: () => void = () => undefined;
    let releaseLater: () => void = () => undefined;
    const earlier = new Promise<void>((resolve) => {
      releaseEarlier = resolve;
    });
    const later = new Promise<void>((resolve) => {
      releaseLater = resolve;
    });
    let reads = 0;
    const { calls } = serve({
      "GET /api/device": () => {
        reads += 1;
        if (reads > 2) {
          return {
            body: { presence: "waiting", label: "Guest", code: "0042" },
            after: later,
          };
        }
        return {
          body: { presence: "refused", label: "Guest", code: null },
          ...(reads === 2 ? { after: earlier } : {}),
        };
      },
      "GET /api/tracks": { status: 403, body: { code: "device_waiting" } },
    });
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Ask again" }));
    await api.tracks().catch(() => undefined);
    await waitFor(() => {
      expect(calls.filter((call) => call === "GET /api/device")).toHaveLength(3);
    });

    await act(async () => {
      releaseEarlier();
      await earlier;
    });
    releaseLater();

    expect(await screen.findByLabelText("Code 0042")).toBeVisible();
  });

  it("shows a waiting device its code, then the sign-in form once an admin allows it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let allowed = false;
    serve({
      "GET /api/device": () => ({
        body: allowed
          ? { presence: "allowed", label: "Safari on iPhone", code: null }
          : { presence: "waiting", label: "Safari on iPhone", code: "4821" },
      }),
      "GET /api/me": { status: 401, body: { detail: "Sign in first." } },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    render(<App />);
    const code = await screen.findByLabelText("Code 4821");

    allowed = true;
    await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS);

    expect(code).toHaveTextContent("4821");
    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("accepts a slow approval poll while the next poll is still pending", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let approve: () => void = () => undefined;
    const approval = new Promise<void>((resolve) => {
      approve = resolve;
    });
    const nextPoll = new Promise<void>(() => undefined);
    let reads = 0;
    serve({
      "GET /api/device": () => {
        reads += 1;
        if (reads === 1) {
          return { body: { presence: "waiting", label: "Guest", code: "4821" } };
        }
        return {
          body: { presence: "allowed", label: "Guest", code: null },
          after: reads === 2 ? approval : nextPoll,
        };
      },
      "GET /api/me": { status: 401 },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    render(<App />);
    await screen.findByLabelText("Code 4821");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ASK_AGAIN_MS * 2);
      expect(reads).toBe(3);
      approve();
    });

    expect(await screen.findByRole("form", { name: "Sign in" })).toBeVisible();
  });

  it("shows the waiting screen when a request is refused for the device, as after it is removed", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/device": { body: { presence: "allowed", label: "Safari on iPhone", code: null } },
    });
    render(<App />);
    await screen.findByRole("button", { name: "Night Drive" });

    serve({
      "GET /api/device": { body: { presence: "waiting", label: "Safari on iPhone", code: "0042" } },
      "GET /api/tracks": {
        status: 403,
        body: { detail: "This device is waiting for approval.", code: "device_waiting" },
      },
    });
    await api.tracks().catch(() => undefined);

    expect(await screen.findByLabelText("Code 0042")).toBeInTheDocument();
  });

  it("shows the starting mark while it asks who is signed in, as the page did before it", async () => {
    serve(signedIn([trackOf(1, "Night Drive")]));

    render(<App />);

    expect(screen.getByText("medleyplay")).toHaveAttribute("aria-busy", "true");
    expect(await screen.findByRole("navigation", { name: "Views" })).toBeInTheDocument();
  });

  it("shows the Library to a signed-in browser", async () => {
    serve(signedIn([trackOf(1, "Night Drive")]));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeInTheDocument();
    expect(rail().getByRole("button", { name: "Alice: account" })).toBeInTheDocument();
  });

  it("says in the header when medleyplay is Offline, and why, leading to Settings", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/mode": { body: modeOf({ online: false, reason: "no_network", network: null }) },
    });

    render(<App />);

    const note = await screen.findByRole("link", { name: "Offline: no network" });
    expect(note).toHaveAttribute("href", "#/settings");
  });

  it("checks the network from the header, and shows nothing once the check reaches the internet", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/mode": { body: modeOf({ online: false, reason: "unreachable" }) },
      "POST /api/mode/check": { body: modeOf() },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Check the network" }));

    await waitFor(() => {
      expect(screen.queryByRole("link", { name: /^Offline/ })).not.toBeInTheDocument();
    });
    expect(calls).toContain("POST /api/mode/check");
  });

  it("says Still offline in the header when the check can't reach the internet", async () => {
    const unreachable = modeOf({
      online: false,
      reason: "unreachable",
      since: "2026-10-27T12:00:00Z",
    });
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/mode": { body: unreachable },
      "POST /api/mode/check": { body: { ...unreachable, checked_at: "2026-10-27T12:05:00Z" } },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Check the network" }));

    expect(
      await screen.findByRole("link", { name: "Still offline: the internet can't be reached" }),
    ).toBeInTheDocument();
  });

  it.each([
    ["set to Always Offline", modeOf({ setting: "offline", online: false, reason: "set_offline" })],
    [
      "on a metered network",
      modeOf({
        online: false,
        reason: "metered",
        network: { kind: "wifi", metered_as: "Hotspot", hotspot_like: true },
      }),
    ],
  ])("offers no check of the network while %s", async (_, mode) => {
    serve({ ...signedIn([trackOf(1, "Night Drive")]), "GET /api/mode": { body: mode } });

    render(<App />);

    expect(await screen.findByRole("link", { name: /^Offline/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check the network" })).not.toBeInTheDocument();
  });

  it("says nothing in the header while medleyplay is Online", async () => {
    serve(signedIn([trackOf(1, "Night Drive")]));

    render(<App />);

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Offline/ })).not.toBeInTheDocument();
  });

  it("offers Find details online in the menu of a Track that can be looked up, not of another", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive"), trackOf(2, "Melt")]),
      "GET /api/enrichers/bilibili-details": {
        body: enricherOf("bilibili-details", [1]),
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    expect(
      await screen.findByRole("menuitem", { name: "Find details online" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More actions for Melt" }));

    expect(await screen.findByRole("menuitem", { name: "Edit details…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Find details online" })).toBeNull();
  });

  it("asks for the Track's details and says so when Find details online is chosen", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/bilibili-details": {
        body: enricherOf("bilibili-details", [1]),
      },
      "POST /api/enrichers/bilibili-details/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find details online" }));

    const row = screen.getByRole("row", { name: /Night Drive/u });
    expect(
      await within(row).findByRole("img", { name: "Looking up on Bilibili" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("Looking up “Night Drive” on Bilibili.")).toHaveClass(
      "visually-hidden",
    );
    expect(document.querySelector(".notice")).toBeEmptyDOMElement();
    expect(calls).toContain("POST /api/enrichers/bilibili-details/tracks/1");
  });

  it("marks a song as an album from its menu, and its row shows it at once", async () => {
    const saved: unknown[] = [];
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "POST /api/tracks/details": (body) => {
        saved.push(body);
        return { body: { changed: 1 } };
      },
      "GET /api/tracks/1": {
        body: trackOf(1, "Night Drive", { kind: "album", kind_reason: "named" }),
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Mark as album" }));

    await waitFor(() => {
      const row = screen.getByRole("row", { name: /Night Drive/u });
      expect(within(row).getByRole("img", { name: "Album" })).toBeInTheDocument();
    });
    expect(screen.getByText("“Night Drive” is now an album.")).toBeVisible();
    expect(saved).toEqual([{ track_ids: [1], values: { kind: "album" } }]);
  });

  it("offers Find on MusicBrainz in the menu of a Track that can be found there, not of another", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive"), trackOf(2, "Melt")]),
      "GET /api/enrichers/musicbrainz": {
        body: enricherOf("musicbrainz", [2]),
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Melt" }));
    expect(
      await screen.findByRole("menuitem", { name: "Find on MusicBrainz" }),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "More actions for Night Drive" }));

    expect(await screen.findByRole("menuitem", { name: "Edit details…" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Find on MusicBrainz" })).toBeNull();
  });

  it("asks MusicBrainz about the Track and says so when Find on MusicBrainz is chosen", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/musicbrainz": {
        body: enricherOf("musicbrainz", [1]),
      },
      "POST /api/enrichers/musicbrainz/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find on MusicBrainz" }));

    expect(await screen.findByText("Looking up “Night Drive” on MusicBrainz.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/musicbrainz/tracks/1");
  });

  it("asks the AI about the Track and says so when Suggest details with AI is chosen", async () => {
    const { calls } = serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/ai-details": {
        body: enricherOf("ai-details", [1]),
      },
      "POST /api/enrichers/ai-details/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Suggest details with AI" }));

    expect(await screen.findByText("Asking the AI about “Night Drive”.")).toBeInTheDocument();
    expect(calls).toContain("POST /api/enrichers/ai-details/tracks/1");
  });

  it("asks the AI again about a Track asked today only once someone agrees", async () => {
    const sent: unknown[] = [];
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/ai-details": {
        body: {
          name: "ai-details",
          available: true,
          stopped: null,
          eligible: [1],
          waiting: { "1": new Date(Date.now() + 60 * 60 * 1000).toISOString() },
          asks_again: true,
        },
      },
      "POST /api/enrichers/ai-details/tracks/1": (body) => {
        sent.push(body);
        return { body: { id: 9, state: "queued", failure_message: "" } };
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Suggest details with AI" }));
    const dialog = await screen.findByRole("dialog", { name: "Ask the AI again?" });
    expect(sent).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Ask again" }));

    expect(await screen.findByText("Asking the AI about “Night Drive”.")).toBeInTheDocument();
    expect(sent).toEqual([{ again: true, hint: "" }]);
  });

  it("asks before asking the AI again when the server says it was asked lately", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/ai-details": {
        body: enricherOf("ai-details", [1]),
      },
      "POST /api/enrichers/ai-details/tracks/1": {
        status: 409,
        body: {
          detail: "This Track was looked up in the last 24 hours.",
          code: "asked_recently",
        },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Suggest details with AI" }));

    expect(await screen.findByRole("dialog", { name: "Ask the AI again?" })).toBeInTheDocument();
  });

  it("says the lookup waits while medleyplay is Offline", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/mode": { body: modeOf({ online: false, reason: "no_network", network: null }) },
      "GET /api/enrichers/bilibili-details": {
        body: enricherOf("bilibili-details", [1]),
      },
      "POST /api/enrichers/bilibili-details/tracks/1": {
        body: { id: 9, state: "queued", failure_message: "" },
      },
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Offline: no network" });

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find details online" }));

    expect(
      await screen.findByText(
        "Looking up “Night Drive” on Bilibili. It waits until medleyplay is Online.",
      ),
    ).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /Night Drive/u });
    expect(
      within(row).getByRole("img", { name: "Looking up on Bilibili once medleyplay is Online" }),
    ).toBeInTheDocument();
  });

  it("says why the server refused a lookup", async () => {
    serve({
      ...signedIn([trackOf(1, "Night Drive")]),
      "GET /api/enrichers/bilibili-details": {
        body: enricherOf("bilibili-details", [1]),
      },
      "POST /api/enrichers/bilibili-details/tracks/1": {
        status: 409,
        body: { detail: "This video was looked up in the last 24 hours." },
      },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "More actions for Night Drive" }));
    await user.click(await screen.findByRole("menuitem", { name: "Find details online" }));

    expect(
      await screen.findByText("This video was looked up in the last 24 hours."),
    ).toBeInTheDocument();
  });

  it("asks a signed-out browser to sign in, then shows the Library", async () => {
    serve({
      "GET /api/me": { status: 401, body: { detail: "Sign in first." } },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
      "POST /api/session": (body) =>
        JSON.stringify(body) === JSON.stringify({ username: "alice", password: "secret words" })
          ? { body: ALICE }
          : { status: 401, body: { detail: "The username or password is wrong." } },
      "GET /api/tracks": { body: [trackOf(1, "Night Drive")] },
    });
    render(<App />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "secret words");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("button", { name: "Night Drive" })).toBeInTheDocument();
  });

  it("returns to the sign-in form after signing out", async () => {
    serve({
      ...signedIn([]),
      "DELETE /api/session": { status: 204 },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    render(<App />);
    const user = userEvent.setup();

    await screen.findByRole("navigation", { name: "Views" });
    await user.click(rail().getByRole("button", { name: "Alice: account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByRole("form", { name: "Sign in" })).toBeInTheDocument();
  });

  it("handles device refusal during sign-out without opening the sign-in form", async () => {
    let removed = false;
    const { calls } = serve({
      ...signedIn([]),
      "GET /api/device": () => ({
        body: removed
          ? { presence: "waiting", label: "Guest", code: "0042" }
          : { presence: "allowed", label: "Guest", code: null },
      }),
      "DELETE /api/session": { status: 403, body: { code: "device_waiting" } },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Views" });
    await user.click(rail().getByRole("button", { name: "Alice: account" }));
    removed = true;

    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));

    expect(await screen.findByLabelText("Code 0042")).toBeVisible();
    expect(calls).not.toContain("GET /api/setup");
  });

  it("keeps a device recheck when an earlier sign-out succeeds", async () => {
    let finishSignOut: () => void = () => undefined;
    let answerDevice: () => void = () => undefined;
    const signingOut = new Promise<void>((resolve) => {
      finishSignOut = resolve;
    });
    const checkingDevice = new Promise<void>((resolve) => {
      answerDevice = resolve;
    });
    let removed = false;
    const { calls } = serve({
      ...signedIn([]),
      "GET /api/device": () =>
        removed
          ? {
              body: { presence: "waiting", label: "Guest", code: "0042" },
              after: checkingDevice,
            }
          : { body: { presence: "allowed", label: "Guest", code: null } },
      "GET /api/playlists": () =>
        removed ? { status: 403, body: { code: "device_waiting" } } : { body: [] },
      "DELETE /api/session": { status: 204, after: signingOut },
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
    });
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("navigation", { name: "Views" });
    await user.click(rail().getByRole("button", { name: "Alice: account" }));
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(calls).toContain("DELETE /api/session");

    removed = true;
    await act(async () => {
      await api.playlists().catch(() => undefined);
    });
    expect(calls.filter((call) => call === "GET /api/device")).toHaveLength(2);
    await act(async () => {
      finishSignOut();
      await signingOut;
    });
    answerDevice();

    expect(await screen.findByLabelText("Code 0042")).toBeVisible();
    expect(calls).not.toContain("GET /api/setup");
  });
});
