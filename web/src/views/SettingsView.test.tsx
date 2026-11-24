import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeteredNetwork, Mode, Settings, Storage, StorageInspection } from "../api";
import {
  type Routes,
  enricherOf,
  modeOf,
  modeSettingsOf,
  serve,
  settingsOf,
} from "../testing/server";
import { SettingsView } from "./SettingsView";

const GB = 1_000_000_000;

/** A limit of 20 GB, saved twice before, so at revision 2. */
const LIMIT_20: Settings = settingsOf({ storage_limit: 20 * GB, revision: 2 });

/** 1.5 GB of Downloads and 0.5 GB of prepared copies, under a 20 GB limit. */
const USING_2: Storage = {
  limit: 20 * GB,
  downloads: 1.5 * GB,
  cache: 0.5 * GB,
  reserved: 0,
  free: 100 * GB,
  disk_size: 500 * GB,
  wanted: 1.2 * GB,
  last_evaluation: null,
  error: null,
  preview: null,
};

function open(
  admin: boolean,
  routes: Routes = {},
  mode: Mode = modeOf(),
  metered: readonly MeteredNetwork[] = [],
  onModeChecked: (mode: Mode) => void = vi.fn(),
  onKindsChanged: () => void = vi.fn(),
) {
  const served = serveSettings(routes, mode, metered);
  render(
    <SettingsView
      admin={admin}
      mode={mode}
      onModeChecked={onModeChecked}
      onEnrichersChanged={vi.fn()}
      onKindsChanged={onKindsChanged}
    />,
  );
  return served;
}

/** Open an admin's Settings at the section `section` names, as `#/settings?section=…` does. */
function openAt(section: string) {
  serveSettings();
  render(
    <SettingsView
      admin
      route={{ view: "settings", section }}
      mode={modeOf()}
      onModeChecked={vi.fn()}
      onEnrichersChanged={vi.fn()}
      onKindsChanged={vi.fn()}
    />,
  );
}

/** Answer what each section reads: a 20 GB limit, no AI provider, nothing waiting. */
function serveSettings(
  routes: Routes = {},
  mode: Mode = modeOf(),
  metered: readonly MeteredNetwork[] = [],
) {
  return serve({
    "GET /api/settings": { body: LIMIT_20 },
    "GET /api/image-search": { body: { configured: false } },
    "GET /api/storage": { body: USING_2 },
    "GET /api/proxies/bilibili": { body: null },
    "GET /api/enrichers/bilibili-details": {
      body: enricherOf("bilibili-details", [1, 2]),
    },
    "GET /api/enrichers/musicbrainz": {
      body: enricherOf("musicbrainz", [1, 2, 3]),
    },
    "GET /api/ai": {
      body: { providers: [], presets: [], max_providers: 5, max_description: 6000 },
    },
    "GET /api/enrichers/ai-details": {
      body: enricherOf("ai-details", [1]),
    },
    "GET /api/devices": { body: { admission: "ask", revision: 0, waiting: [], allowed: [] } },
    ...modeSettingsOf(mode, metered),
    ...routes,
  });
}

/** The server on an iPhone hotspot an admin marked metered, so Offline. */
const ON_THE_HOTSPOT = modeOf({
  online: false,
  reason: "metered",
  network: { kind: "wifi", metered_as: "iPhone hotspot", hotspot_like: true },
});

const HOTSPOT_MARK: MeteredNetwork = {
  id: 1,
  name: "iPhone hotspot",
  subnet: "172.20.10.0/28",
  hotspot_like: true,
};

const network = () => within(screen.getByRole("region", { name: "Network" }));
const storage = () => within(screen.getByRole("region", { name: "Downloads and storage" }));
/** The buttons in the sections' headings, which fold and open each section. */
const folded = () =>
  screen
    .getAllByRole("heading", { level: 3 })
    .map((heading) => within(heading).getByRole("button"))
    .filter((toggle) => toggle.getAttribute("aria-expanded") === "false");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the image search section", () => {
  it("lets an admin save, replace, and remove the key without showing it again", async () => {
    let saved: unknown;
    const { calls } = open(true, {
      "PUT /api/image-search/key": (body) => {
        saved = body;
        return { status: 204 };
      },
      "DELETE /api/image-search/key": { status: 204 },
    });
    const section = within(screen.getByRole("region", { name: "Image search" }));
    const key = await section.findByLabelText("Tavily API key");
    const user = userEvent.setup();
    await user.type(key, "example-only");
    await user.click(section.getByRole("button", { name: "Save key" }));

    expect(saved).toEqual({ key: "example-only" });
    expect(section.queryByLabelText("Tavily API key")).toBeNull();
    const change = await section.findByRole("button", { name: "Change Key" });
    expect(change).toHaveFocus();
    await user.click(change);
    const replacement = section.getByLabelText("Tavily API key");
    expect(replacement).toHaveValue("");
    await user.type(replacement, "replacement-example");
    await user.click(section.getByRole("button", { name: "Save key" }));
    expect(saved).toEqual({ key: "replacement-example" });
    await user.click(await section.findByRole("button", { name: "Remove Key" }));
    expect(calls).toContain("DELETE /api/image-search/key");
    expect(section.queryByRole("button", { name: "Remove Key" })).toBeNull();
    expect(section.getByLabelText("Tavily API key")).toHaveValue("");
    expect(section.getByLabelText("Tavily API key")).toHaveFocus();
  });

  it("lets an admin cancel a replacement without changing the saved key", async () => {
    const { calls } = open(true, { "GET /api/image-search": { body: { configured: true } } });
    const section = within(screen.getByRole("region", { name: "Image search" }));
    const user = userEvent.setup();
    const change = await section.findByRole("button", { name: "Change Key" });
    expect(section.getByRole("button", { name: "Remove Key" })).toBeEnabled();
    expect(change).not.toHaveFocus();

    await user.click(change);
    expect(section.getByLabelText("Tavily API key")).toHaveFocus();
    await user.keyboard("discard-this");
    await user.click(section.getByRole("button", { name: "Cancel" }));

    expect(section.getByRole("button", { name: "Change Key" })).toHaveFocus();
    expect(calls).not.toContain("PUT /api/image-search/key");
    expect(calls).not.toContain("DELETE /api/image-search/key");
    await user.keyboard("{Enter}");
    expect(section.getByLabelText("Tavily API key")).toHaveValue("");
  });

  it("does not show or read key settings for a member", () => {
    const { calls } = open(false);
    expect(screen.queryByRole("region", { name: "Image search" })).toBeNull();
    expect(calls).not.toContain("GET /api/image-search");
  });
});

describe("the Bilibili section", () => {
  it("is the admin's, with the proxy for Bilibili", async () => {
    open(true);

    const bilibili = within(screen.getByRole("region", { name: "Bilibili" }));

    expect(bilibili.getByRole("heading", { name: "Proxy" })).toBeInTheDocument();
    expect(await bilibili.findByLabelText("Proxy URL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to Bilibili" })).toBeInTheDocument();
  });

  it("also holds the video details, for which an admin chooses when they are asked", async () => {
    open(true);

    const bilibili = within(screen.getByRole("region", { name: "Bilibili" }));

    expect(bilibili.getByRole("heading", { name: "Video details" })).toBeInTheDocument();
    expect(await bilibili.findByText("2 Tracks can have their details found.")).toBeInTheDocument();
    expect(bilibili.getByRole("radio", { name: "Manually" })).toBeChecked();
  });

  it("is not shown to a member, who never asks for the proxy", async () => {
    const { calls } = open(false);

    await screen.findByText("The storage limit is 20 GB, set by an admin.");

    expect(screen.queryByRole("region", { name: "Bilibili" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to Bilibili" })).toBeNull();
    expect(calls).not.toContain("GET /api/proxies/bilibili");
    expect(calls).not.toContain("GET /api/enrichers/bilibili-details");
  });
});
describe("the Other devices section", () => {
  it("lets an admin choose what new devices do", async () => {
    open(true);

    const devices = within(screen.getByRole("region", { name: "Other devices" }));

    expect(await devices.findByRole("radio", { name: /^Ask first/ })).toBeChecked();
    expect(devices.getByText(/No devices yet/)).toBeInTheDocument();
  });

  it("is not shown to a member, who never asks for the devices", async () => {
    const { calls } = open(false);

    await screen.findByText("The storage limit is 20 GB, set by an admin.");

    expect(screen.queryByRole("region", { name: "Other devices" })).toBeNull();
    expect(calls).not.toContain("GET /api/devices");
  });
});

describe("the AI section", () => {
  it("is the admin's, with the providers and the suggestion for every Track", async () => {
    open(true);

    const ai = within(screen.getByRole("region", { name: "AI" }));

    expect(await ai.findByText("No AI provider is set up.")).toBeInTheDocument();
    expect(await ai.findByText("1 Track can be given suggestions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to AI" })).toBeInTheDocument();
  });

  it("is not shown to a member, who never asks for the provider", async () => {
    const { calls } = open(false);

    await screen.findByText("The storage limit is 20 GB, set by an admin.");

    expect(screen.queryByRole("region", { name: "AI" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to AI" })).toBeNull();
    expect(calls).not.toContain("GET /api/ai");
    expect(calls).not.toContain("GET /api/enrichers/ai-details");
  });
});

describe("the notes offered when asking the AI", () => {
  /** Open an admin's AI section over `LIMIT_20`, keeping each save in `sent`. */
  async function notesOpen(sent: unknown[]) {
    open(true, {
      "GET /api/settings": { body: LIMIT_20 },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...(body as Settings), revision: 3 } };
      },
    });
    const ai = within(screen.getByRole("region", { name: "AI" }));
    return {
      ai,
      details: within(await ai.findByRole("group", { name: "Notes when asking for details" })),
      songs: within(await ai.findByRole("group", { name: "Notes when asking for songs" })),
    };
  }

  it("lists the household's notes for asking for details and for songs", async () => {
    const { details, songs } = await notesOpen([]);

    expect(details.getAllByRole("textbox").map((box) => (box as HTMLInputElement).value)).toEqual([
      "Name the album the song first came out on.",
    ]);
    expect(songs.getAllByRole("textbox")).toHaveLength(2);
  });

  it("adds a note for asking for songs, saved once typed", async () => {
    const sent: unknown[] = [];
    const { ai, songs } = await notesOpen(sent);
    const user = userEvent.setup();

    await user.click(songs.getByRole("button", { name: "Add a note" }));
    await user.keyboard("A concert: one song per chapter.{Enter}");

    expect(await ai.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([
      {
        ...LIMIT_20,
        ai_notes: [
          ...LIMIT_20.ai_notes,
          { ask: "songs", text: "A concert: one song per chapter." },
        ],
      },
    ]);
  });

  it("removes a note at once", async () => {
    const sent: unknown[] = [];
    const { ai, details } = await notesOpen(sent);

    await userEvent.click(
      details.getByRole("button", {
        name: "Remove the note “Name the album the song first came out on.”",
      }),
    );

    expect(await ai.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([
      { ...LIMIT_20, ai_notes: LIMIT_20.ai_notes.filter((note) => note.ask === "songs") },
    ]);
  });
});

describe("the MusicBrainz section", () => {
  it("is the admin's, and an admin queues every Track that can be found there", async () => {
    open(true);

    const musicbrainz = within(screen.getByRole("region", { name: "MusicBrainz" }));

    expect(
      await musicbrainz.findByText("3 Tracks can be found on MusicBrainz."),
    ).toBeInTheDocument();
    expect(musicbrainz.getByRole("radio", { name: "Manually" })).toBeChecked();
    expect(screen.getByRole("button", { name: "Go to MusicBrainz" })).toBeInTheDocument();
  });

  it("is not shown to a member, who never asks for what it can queue", async () => {
    const { calls } = open(false);

    await screen.findByText("The storage limit is 20 GB, set by an admin.");

    expect(screen.queryByRole("region", { name: "MusicBrainz" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to MusicBrainz" })).toBeNull();
    expect(calls).not.toContain("GET /api/enrichers/musicbrainz");
  });

  it("finds covers of every album with none, once chosen", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/settings": { body: LIMIT_20 },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, find_album_covers: "missing", revision: 3 } };
      },
    });
    const musicbrainz = within(screen.getByRole("region", { name: "MusicBrainz" }));
    const covers = within(
      await musicbrainz.findByRole("group", { name: "Find covers of albums with none" }),
    );

    expect(covers.getByRole("radio", { name: /^Songs up next/u })).toBeChecked();
    await userEvent.click(covers.getByRole("radio", { name: /^Every album/u }));

    expect(await musicbrainz.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, find_album_covers: "missing" }]);
  });

  it("has the AI pick a cover where none plainly fits, once turned on", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/settings": { body: LIMIT_20 },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, pick_album_covers_by_ai: true, revision: 3 } };
      },
    });
    const musicbrainz = within(screen.getByRole("region", { name: "MusicBrainz" }));

    await userEvent.click(
      await musicbrainz.findByRole("switch", { name: "Pick covers by AI when none plainly fits" }),
    );

    expect(await musicbrainz.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, pick_album_covers_by_ai: true }]);
  });
});

describe("the Lyrics section", () => {
  const lyrics = () => within(screen.getByRole("region", { name: "Lyrics" }));

  it("turns NetEase on at once, to be asked for the lyrics LRCLIB lacks", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/enrichers/lyrics": { body: { ...enricherOf("lyrics", [1]), mode: "next" } },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, lyrics_sites: ["netease"], revision: 3 } };
      },
    });
    const netease = await lyrics().findByRole("switch", {
      name: "Also look on NetEase Cloud Music",
    });

    expect(netease).not.toBeChecked();
    await userEvent.click(netease);

    expect(await lyrics().findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, lyrics_sites: ["netease"] }]);
    expect(netease).toBeChecked();
  });

  it("turns suggesting the lyrics of a song that nearly matches off at once", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/enrichers/lyrics": { body: { ...enricherOf("lyrics", [1]), mode: "next" } },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, suggest_lyrics: false, revision: 3 } };
      },
    });
    const suggest = await lyrics().findByRole("switch", {
      name: "Suggest lyrics that nearly match",
    });

    expect(suggest).toBeChecked();
    await userEvent.click(suggest);

    expect(await lyrics().findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, suggest_lyrics: false }]);
    expect(suggest).not.toBeChecked();
  });
});

describe("the Deezer section", () => {
  it("turns Deezer on at once, to be asked for pictures of artists", async () => {
    const sent: unknown[] = [];
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, picture_sites: ["deezer"], revision: 3 } };
      },
    });
    const deezer = within(screen.getByRole("region", { name: "Deezer" }));
    const finding = await deezer.findByRole("switch", { name: "Find artist photos on Deezer" });

    expect(finding).not.toBeChecked();
    await userEvent.click(finding);

    expect(await deezer.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, picture_sites: ["deezer"] }]);
    expect(finding).toBeChecked();
  });

  it("has the AI pick each artist's picture as soon as they are found, once Deezer is on", async () => {
    const sent: unknown[] = [];
    const deezerOn: Settings = { ...LIMIT_20, picture_sites: ["deezer"] };
    open(true, {
      "GET /api/settings": { body: deezerOn },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...deezerOn, pick_pictures_by_ai: true, revision: 3 } };
      },
    });
    const deezer = within(screen.getByRole("region", { name: "Deezer" }));
    const picking = await deezer.findByRole("switch", {
      name: "Pick by AI as soon as pictures are found",
    });

    await userEvent.click(picking);

    expect(await deezer.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...deezerOn, pick_pictures_by_ai: true }]);
  });

  it("looks up photos of every artist with none, once chosen", async () => {
    const sent: unknown[] = [];
    const deezerOn: Settings = { ...LIMIT_20, picture_sites: ["deezer"] };
    open(true, {
      "GET /api/settings": { body: deezerOn },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...deezerOn, find_artist_photos: "missing", revision: 3 } };
      },
    });
    const deezer = within(screen.getByRole("region", { name: "Deezer" }));

    await userEvent.click(await deezer.findByRole("radio", { name: /^Every artist/u }));

    expect(await deezer.findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...deezerOn, find_artist_photos: "missing" }]);
  });

  it("offers no AI pick while Deezer is off", async () => {
    open(true);
    const deezer = within(screen.getByRole("region", { name: "Deezer" }));

    expect(
      await deezer.findByRole("switch", { name: "Pick by AI as soon as pictures are found" }),
    ).toBeDisabled();
  });

  it("is only for admins", async () => {
    open(false);

    expect(await screen.findByRole("button", { name: "Go to Lyrics" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Go to Deezer" })).toBeNull();
  });
});

describe("storage settings", () => {
  const measured: StorageInspection = {
    downloads: 250,
    cache: 0,
    covers: 500,
    thumbnails: 0,
    database: 125,
    database_companions: 0,
    configuration: 125,
    multiple_accounts: true,
    safe_mode: false,
    wal_enabled: true,
  };

  it("measures server files only when an admin asks, separately from the limit", async () => {
    const read = vi.fn(() => ({ body: measured }));
    open(true, { "GET /api/storage/inspection": read });

    const inspect = await storage().findByRole("button", { name: "Inspect server storage" });
    expect(read).not.toHaveBeenCalled();
    await userEvent.click(inspect);

    const composition = within(
      await storage().findByRole("region", { name: "Storage composition" }),
    );
    expect(composition.getByRole("button", { name: "Refresh server storage" })).toBeVisible();
    expect(storage().queryByRole("button", { name: "Inspect server storage" })).toBeNull();
    expect(composition.getByText("1 KB")).toBeVisible();
    expect(composition.getByText("Original artwork").closest("div")).toHaveTextContent(
      /500 bytes.*50%/u,
    );
    expect(composition.getByText("SQLite database").closest("div")).toHaveTextContent(
      /125 bytes.*12\.5%/u,
    );
    expect(composition.getByText("Prepared audio cache").closest("div")).toHaveTextContent(
      /0 bytes.*0%/u,
    );
    expect(storage().getByText(/of 20 GB used/u)).toBeVisible();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("shows startup settings at the gear on hover and hides them with Escape", async () => {
    open(true, { "GET /api/storage/inspection": { body: measured } });
    const user = userEvent.setup();
    await user.click(await storage().findByRole("button", { name: "Inspect server storage" }));
    const gear = await storage().findByRole("button", { name: "Server settings at startup" });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    await user.hover(gear);

    const tip = await screen.findByRole("tooltip");
    expect(tip).toHaveTextContent(/Multiple accounts: on.*SQLite write-ahead logging: on/u);

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("keeps the previous measurement marked outdated until a refresh finishes", async () => {
    let finish: () => void = () => undefined;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const inspect = vi
      .fn()
      .mockReturnValueOnce({ body: measured })
      .mockReturnValueOnce({ body: { ...measured, downloads: 1_250 }, after: waiting });
    open(true, { "GET /api/storage/inspection": inspect });
    const user = userEvent.setup();
    await user.click(await storage().findByRole("button", { name: "Inspect server storage" }));
    const composition = within(
      await storage().findByRole("region", { name: "Storage composition" }),
    );
    const button = composition.getByRole("button", { name: "Refresh server storage" });

    await user.click(button);

    expect(storage().getByText("Measuring server storage…")).toHaveAttribute("role", "status");
    expect(button).toBeDisabled();
    expect(composition.getByText("1 KB")).toBeVisible();
    expect(composition.getByText("Outdated")).toBeVisible();

    finish();

    expect(await composition.findByText("2 KB")).toBeVisible();
    expect(composition.queryByText("Outdated")).not.toBeInTheDocument();
    expect(button).toBeEnabled();
  });

  it("keeps an outdated measurement available when the refresh fails", async () => {
    let fail = false;
    open(true, {
      "GET /api/storage/inspection": () => (fail ? { status: 409 } : { body: measured }),
    });
    const user = userEvent.setup();
    await user.click(await storage().findByRole("button", { name: "Inspect server storage" }));
    const button = await storage().findByRole("button", { name: "Refresh server storage" });
    fail = true;

    await user.click(button);

    expect(await storage().findByRole("alert")).toHaveTextContent("Could not measure storage");
    expect(storage().getByText("1 KB")).toBeVisible();
    expect(storage().getByText("Outdated")).toBeVisible();
    expect(button).toBeEnabled();
  });

  it("shows what the Downloads and prepared copies use against the limit", async () => {
    open(false);

    expect(await screen.findByText(/of 20 GB used/)).toHaveTextContent("2 GB of 20 GB used");
    expect(screen.getByText("1.5 GB")).toBeInTheDocument();
    expect(screen.getByText("500 MB")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
  });

  it("names the room the Playlists kept downloaded need, estimating songs not downloaded yet", async () => {
    open(false);

    const kept = await storage().findByText("Playlists kept downloaded");

    expect(kept).toHaveAttribute(
      "title",
      "The songs of the Playlists set to Keep downloaded: what their Downloads use, and an estimate for those not downloaded yet",
    );
    expect(kept.closest("div")).toHaveTextContent("1.2 GB");
  });

  it("links the Downloads to the Downloaded view, which lists them", async () => {
    open(false);

    const downloads = await storage().findByRole("link", { name: "Downloads" });

    expect(downloads).toHaveAttribute("href", "#/downloaded");
  });

  it("tells a member the limit an admin set, with nothing to change", async () => {
    open(false);

    expect(
      await screen.findByText("The storage limit is 20 GB, set by an admin."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "Limit in GB" })).toBeNull();
    expect(storage().queryByRole("button", { name: "Inspect server storage" })).toBeNull();
  });

  it("asks before saving a lower limit that removes Downloads, then saves it at the revision read", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/storage?limit=1000000000": {
        body: {
          ...USING_2,
          preview: {
            removals: [
              { kind: "download", size: 400_000_000 },
              { kind: "download", size: 200_000_000 },
              { kind: "cache", size: 80_000_000 },
            ],
          },
        },
      },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, storage_limit: GB, revision: 3 } };
      },
    });
    const size = await screen.findByRole("spinbutton", { name: "Limit in GB" });

    await userEvent.clear(size);
    await userEvent.type(size, "1");
    await userEvent.tab();

    expect(
      await screen.findByText(
        "Saving removes 2 downloads (600 MB) and 1 prepared copy (80 MB) to fit.",
      ),
    ).toBeInTheDocument();
    expect(sent).toEqual([]);
    await userEvent.click(storage().getByRole("button", { name: "Remove and save" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(sent).toEqual([{ ...LIMIT_20, storage_limit: GB }]);
  });

  it("asks again when, by the time it saves, the limit would remove more than was said", async () => {
    const sent: unknown[] = [];
    const removals = [{ kind: "download", size: 400_000_000 }] as const;
    let previews = 0;
    open(true, {
      "GET /api/storage?limit=1000000000": () => {
        previews++;
        return {
          body: {
            ...USING_2,
            preview: { removals: previews === 1 ? removals : [...removals, ...removals] },
          },
        };
      },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: LIMIT_20 };
      },
    });
    const size = await screen.findByRole("spinbutton", { name: "Limit in GB" });
    await userEvent.clear(size);
    await userEvent.type(size, "1");
    await userEvent.tab();
    await screen.findByText("Saving removes 1 download (400 MB) to fit.");

    await userEvent.click(storage().getByRole("button", { name: "Remove and save" }));

    expect(await screen.findByText("Saving removes 2 downloads (800 MB) to fit.")).toBeVisible();
    expect(sent).toEqual([]);
  });

  it("keeps the limit when asked to, removing nothing", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/storage?limit=1000000000": {
        body: { ...USING_2, preview: { removals: [{ kind: "download", size: 400_000_000 }] } },
      },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: LIMIT_20 };
      },
    });
    const size = await screen.findByRole("spinbutton", { name: "Limit in GB" });
    await userEvent.clear(size);
    await userEvent.type(size, "1");
    await userEvent.tab();

    await userEvent.click(await storage().findByRole("button", { name: "Keep the limit" }));

    expect(size).toHaveValue(20);
    expect(storage().queryByRole("button", { name: "Remove and save" })).toBeNull();
    expect(sent).toEqual([]);
  });

  it("saves a higher limit on its own once typing pauses", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/storage?limit=30000000000": { body: { ...USING_2, preview: { removals: [] } } },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, storage_limit: 30 * GB, revision: 3 } };
      },
    });
    const size = await screen.findByRole("spinbutton", { name: "Limit in GB" });

    await userEvent.clear(size);
    await userEvent.type(size, "30");

    expect(await storage().findByText("Saved.", {}, { timeout: 3000 })).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, storage_limit: 30 * GB }]);
  });

  it("saves no limit at all", async () => {
    const sent: unknown[] = [];
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, storage_limit: null, revision: 3 } };
      },
    });

    await userEvent.click(await screen.findByRole("radio", { name: "No limit" }));

    await waitFor(() => {
      expect(sent).toEqual([{ ...LIMIT_20, storage_limit: null }]);
    });
  });

  it("shows the limit as it is now when someone else changed it first", async () => {
    open(true, {
      "GET /api/settings": { body: LIMIT_20 },
      "PUT /api/settings": { status: 409, body: { detail: "The settings changed." } },
    });
    await screen.findByRole("spinbutton", { name: "Limit in GB" });
    serve({
      "GET /api/settings": { body: { ...LIMIT_20, storage_limit: 50 * GB, revision: 3 } },
      "PUT /api/settings": { status: 409, body: { detail: "The settings changed." } },
    });

    await userEvent.click(screen.getByRole("radio", { name: "No limit" }));

    expect(
      await storage().findByText("Someone else changed this first, so here it is now."),
    ).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "Limit in GB" })).toHaveValue(50);
  });

  it("saves the limit over another change to the settings made since", async () => {
    const sent: unknown[] = [];
    const since: Settings = { ...LIMIT_20, album_minutes: 45, revision: 3 };
    open(true);
    await screen.findByRole("spinbutton", { name: "Limit in GB" });
    serve({
      "GET /api/settings": { body: since },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return (body as Settings).revision === since.revision
          ? { body: { ...since, storage_limit: null, revision: 4 } }
          : { status: 409, body: { detail: "The settings changed." } };
      },
    });

    await userEvent.click(screen.getByRole("radio", { name: "No limit" }));

    expect(await storage().findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([
      { ...LIMIT_20, storage_limit: null },
      { ...since, storage_limit: null },
    ]);
  });

  it("says a limit that couldn't be saved wasn't, and saves it once back online", async () => {
    const sent: unknown[] = [];
    let reachable = false;
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        return reachable
          ? { body: { ...LIMIT_20, storage_limit: null, revision: 3 } }
          : { status: 503, body: { detail: "The server is restarting." } };
      },
    });

    await userEvent.click(await screen.findByRole("radio", { name: "No limit" }));
    expect(await storage().findByText(/^Not saved: /)).toBeVisible();
    reachable = true;
    window.dispatchEvent(new Event("online"));

    expect(await storage().findByText("Saved.")).toBeVisible();
    expect(sent).toHaveLength(2);
  });

  it("only opens the size to type when a limit is chosen, saving it once the size is left", async () => {
    const sent: unknown[] = [];
    open(true, {
      "GET /api/settings": { body: { ...LIMIT_20, storage_limit: null } },
      "GET /api/storage?limit=20000000000": { body: { ...USING_2, preview: { removals: [] } } },
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, revision: 3 } };
      },
    });

    await userEvent.click(await screen.findByRole("radio", { name: /Up to/ }));
    const size = screen.getByRole("spinbutton", { name: "Limit in GB" });
    const opened = { focused: size === document.activeElement, sent: [...sent] };
    await userEvent.tab();

    expect(opened).toEqual({ focused: true, sent: [] });
    expect(size).toHaveValue(20);
    await waitFor(() => {
      expect(sent).toEqual([{ ...LIMIT_20, storage_limit: 20 * GB, revision: 2 }]);
    });
  });

  it("puts back the saved limit when the size is left as no size at all", async () => {
    const sent: unknown[] = [];
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: LIMIT_20 };
      },
    });
    const size = await screen.findByRole("spinbutton", { name: "Limit in GB" });

    await userEvent.clear(size);
    await userEvent.tab();

    expect(storage().getByText("Not saved: type a size in GB, such as 20.")).toBeVisible();
    expect(size).toHaveValue(20);
    expect(sent).toEqual([]);
  });
});

describe("the Settings sections", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("fold under their headings, and stay folded on the next visit", async () => {
    open(true);
    const heading = screen.getByRole("button", { name: "Keyboard shortcuts" });

    await userEvent.click(heading);

    expect(heading).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Reset to defaults" })).not.toBeInTheDocument();

    cleanup();
    open(true);

    expect(screen.getByRole("button", { name: "Keyboard shortcuts" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("open from their names at the top, which go to them", async () => {
    localStorage.setItem("medleyplay.settings.folded.v1", JSON.stringify(["storage"]));
    open(true);
    const sections = screen.getByRole("navigation", { name: "Settings sections" });

    await userEvent.click(
      within(sections).getByRole("button", { name: "Go to Downloads and storage" }),
    );

    const heading = screen.getByRole("button", { name: "Downloads and storage" });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(heading).toHaveFocus();
    expect(await screen.findByText(/of 20 GB used/)).toBeVisible();
  });

  it("open at the one a link names, even when it was folded", () => {
    localStorage.setItem("medleyplay.settings.folded.v1", JSON.stringify(["ai"]));

    openAt("ai");

    const heading = screen.getByRole("button", { name: "AI" });
    expect(heading).toHaveAttribute("aria-expanded", "true");
    expect(heading).toHaveFocus();
  });

  it("open as they were when a link names a section there is not", () => {
    localStorage.setItem("medleyplay.settings.folded.v1", JSON.stringify(["ai"]));

    openAt("nowhere");

    expect(screen.getByRole("button", { name: "AI" })).toHaveAttribute("aria-expanded", "false");
  });

  it("fold all at once, and open all again", async () => {
    open(true);

    await userEvent.click(screen.getByRole("button", { name: "Fold all" }));

    expect(folded().map((toggle) => toggle.textContent)).toEqual([
      "Appearance",
      "Keyboard shortcuts",
      "Network",
      "Other devices",
      "Songs and albums",
      "Your ratings",
      "Downloads and storage",
      "Bilibili",
      "MusicBrainz",
      "Deezer",
      "Image search",
      "Lyrics",
      "AI",
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Open all" }));

    expect(folded()).toEqual([]);
  });
});

describe("the Network section", () => {
  it("says why medleyplay is Offline, and the network the server is on", async () => {
    open(false, {}, ON_THE_HOTSPOT, [HOTSPOT_MARK]);

    expect(await network().findByText("Offline: on a metered network.")).toBeVisible();
    expect(network().getByText("On Wi-Fi, marked metered as “iPhone hotspot”.")).toBeVisible();
  });

  it("says when the internet was last checked, and checks it now when asked", async () => {
    const unreachable = modeOf({ online: false, reason: "unreachable" });
    const checked = vi.fn();
    open(false, { "POST /api/mode/check": { body: modeOf() } }, unreachable, [], checked);

    expect(await network().findByText(/^Internet last checked at /)).toBeVisible();
    await userEvent.click(network().getByRole("button", { name: "Check now" }));

    await waitFor(() => {
      expect(checked).toHaveBeenCalledWith(modeOf());
    });
  });

  it("says when a settling Mode goes Online, and how many downloads wait", async () => {
    const settling = modeOf({
      online: false,
      reason: "settling",
      online_at: "2026-10-27T12:00:30Z",
      held_jobs: 2,
    });

    open(false, {}, settling);

    expect(await network().findByText(/Goes Online at .+ if nothing changes\./)).toBeVisible();
    expect(network().getByText("2 downloads wait for Online.")).toBeVisible();
  });

  it("lets an admin choose the setting, saved at the revision read", async () => {
    const served = open(true);

    await userEvent.click(await network().findByRole("radio", { name: /^Always Offline/ }));

    expect(network().getByRole("radio", { name: /^Always Offline/ })).toBeChecked();
    expect(served.calls).toContain("PUT /api/mode/settings");
  });

  it("shows the setting as it is now when it changed elsewhere", async () => {
    open(true, {
      "PUT /api/mode/settings": { status: 409, body: { detail: "Saved since." } },
    });

    await userEvent.click(await network().findByRole("radio", { name: /^Always Online/ }));

    expect(await network().findByText(/changed elsewhere/)).toBeVisible();
    expect(network().getByRole("radio", { name: /^Auto/ })).toBeChecked();
  });

  it("lets an admin mark the network the server is on metered, and remove the mark", async () => {
    open(true);

    await userEvent.type(
      await network().findByRole("textbox", { name: /Mark this network/ }),
      "Office",
    );
    await userEvent.click(network().getByRole("button", { name: "Mark metered" }));
    const removing = await network().findByRole("button", { name: "Remove the mark on Office" });
    await userEvent.click(removing);

    await waitFor(() => {
      expect(network().queryByText("Office")).not.toBeInTheDocument();
    });
  });

  it("says a network on a phone hotspot's usual subnet looks like one", async () => {
    const onAHotspot = modeOf({
      network: { kind: "wifi", metered_as: null, hotspot_like: true },
    });

    open(true, {}, onAHotspot);

    expect(await network().findByText("This network looks like a phone's hotspot.")).toBeVisible();
  });

  it("shows a member the setting and the marks, with nothing to change", async () => {
    open(false, {}, ON_THE_HOTSPOT, [HOTSPOT_MARK]);

    expect(await network().findByText(/^Auto: .+\. An admin changes this\.$/)).toBeVisible();
    expect(network().getByText("iPhone hotspot")).toBeVisible();
    expect(network().queryByRole("radio")).not.toBeInTheDocument();
    expect(network().queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });
});

describe("the Songs and albums section", () => {
  const kinds = () => within(screen.getByRole("region", { name: "Songs and albums" }));

  it("saves turning off guessing that a long file is an album at once, and asks for the Tracks again", async () => {
    const sent: unknown[] = [];
    const changed = vi.fn();
    open(
      true,
      {
        "PUT /api/settings": (body) => {
          sent.push(body);
          return { body: { ...LIMIT_20, album_minutes: null, revision: 3 } };
        },
      },
      modeOf(),
      [],
      vi.fn(),
      changed,
    );

    await userEvent.click(
      await kinds().findByRole("checkbox", { name: "Guess that a long file is an album" }),
    );

    expect(await kinds().findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([{ ...LIMIT_20, album_minutes: null }]);
    expect(changed).toHaveBeenCalledOnce();
  });

  it("saves at once that long files are split when their list can be trusted", async () => {
    const sent: unknown[] = [];
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, split_albums: "auto", revision: 3 } };
      },
    });

    await userEvent.click(await kinds().findByRole("radio", { name: /^Auto/u }));

    await waitFor(() => {
      expect(sent).toEqual([{ ...LIMIT_20, split_albums: "auto" }]);
    });
    expect(kinds().getByRole("radio", { name: /^Auto/u })).toBeChecked();
  });

  it("tells a member what becomes of long files, with nothing to change", async () => {
    open(false);

    expect(await kinds().findByText(/^Split albums: Ask first\./u)).toBeVisible();
    expect(kinds().queryByRole("radio")).toBeNull();
  });

  it("saves how long a file must be to be guessed an album when the field is left", async () => {
    const sent: unknown[] = [];
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        return { body: { ...LIMIT_20, album_minutes: 30, revision: 3 } };
      },
    });
    const minutes = await kinds().findByRole("spinbutton", { name: "Shortest album, in minutes" });

    await userEvent.clear(minutes);
    await userEvent.type(minutes, "30");
    await userEvent.tab();

    await waitFor(() => {
      expect(sent).toEqual([{ ...LIMIT_20, album_minutes: 30 }]);
    });
  });

  it("saves a length typed back after a save, at the revision that save left", async () => {
    let kept: Settings = LIMIT_20;
    const sent: unknown[] = [];
    open(true, {
      "GET /api/settings": () => ({ body: kept }),
      "PUT /api/settings": (body) => {
        sent.push(body);
        kept = { ...(body as Settings), revision: kept.revision + 1 };
        return { body: kept };
      },
    });
    const minutes = await kinds().findByRole("spinbutton", { name: "Shortest album, in minutes" });
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "25");
    await userEvent.tab();
    await kinds().findByText("Saved.");

    await userEvent.clear(minutes);
    await userEvent.type(minutes, "20");
    await userEvent.tab();

    await waitFor(() => {
      expect(sent).toEqual([
        { ...LIMIT_20, album_minutes: 25 },
        { ...LIMIT_20, album_minutes: 20, revision: 3 },
      ]);
    });
  });

  it("keeps the newest settings when another section's first read answers after a save", async () => {
    let release: (value: undefined) => void = () => undefined;
    const slow = new Promise<undefined>((resolve) => {
      release = resolve;
    });
    let kept: Settings = LIMIT_20;
    const sent: unknown[] = [];
    open(true, {
      "GET /api/settings": () => ({ body: kept }),
      "GET /api/storage": { body: USING_2, after: slow },
      "PUT /api/settings": (body) => {
        sent.push(body);
        if ((body as Settings).revision !== kept.revision) {
          return { status: 409, body: { detail: "Saved since." } };
        }
        kept = { ...(body as Settings), revision: kept.revision + 1 };
        return { body: kept };
      },
    });
    const minutes = await kinds().findByRole("spinbutton", { name: "Shortest album, in minutes" });
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "25");
    await userEvent.tab();
    await kinds().findByText("Saved.");
    release(undefined);
    await storage().findByRole("spinbutton", { name: "Limit in GB" });

    await userEvent.clear(minutes);
    await userEvent.type(minutes, "20");
    await userEvent.tab();

    await waitFor(() => {
      expect(sent).toEqual([
        { ...LIMIT_20, album_minutes: 25 },
        { ...LIMIT_20, album_minutes: 20, revision: 3 },
      ]);
    });
  });

  it("saves turning the guess back on while turning it off still saves", async () => {
    let kept: Settings = LIMIT_20;
    const sent: unknown[] = [];
    let answer: (value: undefined) => void = () => undefined;
    open(true, {
      "PUT /api/settings": (body) => {
        sent.push(body);
        kept = { ...(body as Settings), revision: kept.revision + 1 };
        const slow = new Promise<undefined>((resolve) => {
          answer = resolve;
        });
        return sent.length === 1 ? { body: kept, after: slow } : { body: kept };
      },
    });
    const guess = await kinds().findByRole("checkbox", {
      name: "Guess that a long file is an album",
    });

    await userEvent.click(guess);
    await userEvent.click(guess);
    answer(undefined);

    await waitFor(() => {
      expect(sent).toEqual([
        { ...LIMIT_20, album_minutes: null },
        { ...LIMIT_20, album_minutes: 20, revision: 3 },
      ]);
    });
  });

  it("puts back the saved length when it is left as no length at all", async () => {
    open(true);
    const minutes = await kinds().findByRole("spinbutton", { name: "Shortest album, in minutes" });

    await userEvent.clear(minutes);
    await userEvent.tab();

    expect(kinds().getByText("Not saved: type whole minutes from 1 to 600.")).toBeVisible();
    expect(minutes).toHaveValue(20);
  });

  it("saves the storage limit at the revision saving the album length left", async () => {
    let kept: Settings = LIMIT_20;
    const sent: unknown[] = [];
    open(true, {
      "GET /api/settings": () => ({ body: kept }),
      "PUT /api/settings": (body) => {
        sent.push(body);
        const next = body as Settings;
        if (next.revision !== kept.revision) {
          return { status: 409, body: { detail: "Saved since." } };
        }
        kept = { ...next, revision: kept.revision + 1 };
        return { body: kept };
      },
    });
    await userEvent.click(
      await kinds().findByRole("checkbox", { name: "Guess that a long file is an album" }),
    );
    await kinds().findByText("Saved.");

    await userEvent.click(storage().getByRole("radio", { name: "No limit" }));

    expect(await storage().findByText("Saved.")).toBeVisible();
    expect(sent).toEqual([
      { ...LIMIT_20, album_minutes: null },
      { ...LIMIT_20, storage_limit: null, album_minutes: null, revision: 3 },
    ]);
  });

  it("says how long a file is guessed an album to a member, who can't change it", async () => {
    open(false);

    expect(
      await kinds().findByText(
        /A file 20 minutes or longer is guessed an album\. An admin changes this\./,
      ),
    ).toBeVisible();
    expect(kinds().queryByRole("checkbox")).toBeNull();
  });
});
