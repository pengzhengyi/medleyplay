import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeteredNetwork, Mode, Settings, Storage } from "../api";
import { type Routes, enricherOf, modeOf, modeSettingsOf, serve } from "../testing/server";
import { SettingsView } from "./SettingsView";

const GB = 1_000_000_000;

/** A limit of 20 GB, saved twice before, so at revision 2. */
const LIMIT_20: Settings = {
  storage_limit: 20 * GB,
  removal_order: "least_favorite",
  album_minutes: 20,
  split_albums: "approval",
  lyrics_sites: [],
  picture_sites: [],
  revision: 2,
};

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
      section={section}
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

  it("is only for admins", async () => {
    open(false);

    expect(await screen.findByRole("button", { name: "Go to Lyrics" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Go to Deezer" })).toBeNull();
  });
});

describe("storage settings", () => {
  it("shows what the Downloads and prepared copies use against the limit", async () => {
    open(false);

    expect(await screen.findByText(/of 20 GB used/)).toHaveTextContent("2 GB of 20 GB used");
    expect(screen.getByText("1.5 GB")).toBeInTheDocument();
    expect(screen.getByText("500 MB")).toBeInTheDocument();
    expect(screen.getByText("1.2 GB")).toBeInTheDocument();
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
