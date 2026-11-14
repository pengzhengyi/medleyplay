import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { NameToTidy } from "../api";
import { serve } from "../testing/server";
import { TidyNames } from "./TidyNames";

/** 周杰伦's first album, written into the artist of two songs with its year. */
const JAY: NameToTidy = {
  kind: "artist",
  written: "周杰伦2000年发行首张个人",
  name: "周杰伦",
  year: 2000,
  fields: ["artist", "album_artist"],
  track_ids: [11, 12],
  years_differ: 1,
};

/** The Beatles with their Chinese name, as one album's artist. */
const BEATLES: NameToTidy = {
  kind: "artist",
  written: "The Beatles（披头士）",
  name: "The Beatles",
  year: null,
  fields: ["album_artist"],
  track_ids: [21],
  years_differ: 0,
};

const openList = async () => {
  await userEvent.click(await screen.findByRole("button", { name: "Tidy 2 names" }));
  return screen.getByRole("dialog", { name: "Tidy names" });
};

describe("tidying names", () => {
  it("offers nothing while every name is tidy", async () => {
    const server = serve({ "GET /api/names-to-tidy": { body: { names: [] } } });

    render(<TidyNames />);

    await expect.poll(() => server.calls).toContain("GET /api/names-to-tidy");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("lists each name as written, its tidy form, its year, and the songs it is on", async () => {
    serve({ "GET /api/names-to-tidy": { body: { names: [JAY, BEATLES] } } });
    render(<TidyNames />);

    const list = await openList();

    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("周杰伦2000年发行首张个人");
    expect(rows[0]).toHaveTextContent("周杰伦");
    expect(rows[0]).toHaveTextContent("2000");
    expect(rows[0]).toHaveTextContent("2 songs, 1 keeps its own year");
    expect(rows[0]).not.toHaveTextContent("Album artist");
    expect(rows[1]).toHaveTextContent("Album artist");
    expect(rows[1]).toHaveTextContent("1 song");
  });

  it("tidies a name, then lists what is left", async () => {
    let names = [JAY, BEATLES];
    const server = serve({
      "GET /api/names-to-tidy": () => ({ body: { names } }),
      "POST /api/names-to-tidy/tidy": () => {
        names = [BEATLES];
        return { body: { changed: 2 } };
      },
    });
    render(<TidyNames />);
    const list = await openList();

    await userEvent.click(
      within(list).getByRole("button", { name: "Tidy 周杰伦2000年发行首张个人 to 周杰伦" }),
    );

    await expect.poll(() => within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(server.calls).toContain("POST /api/names-to-tidy/tidy");
  });

  it("keeps a name as written, so it leaves the list", async () => {
    let names = [JAY, BEATLES];
    const server = serve({
      "GET /api/names-to-tidy": () => ({ body: { names } }),
      "POST /api/names-to-tidy/keep": () => {
        names = [JAY];
        return { status: 204 };
      },
    });
    render(<TidyNames />);
    const list = await openList();

    await userEvent.click(
      within(list).getByRole("button", { name: "Keep The Beatles（披头士） as written" }),
    );

    await expect.poll(() => within(list).queryAllByRole("listitem")).toHaveLength(1);
    expect(server.calls).toContain("POST /api/names-to-tidy/keep");
  });

  it("tidies every name at once", async () => {
    let names = [JAY, BEATLES];
    const tidied: unknown[] = [];
    serve({
      "GET /api/names-to-tidy": () => ({ body: { names } }),
      "POST /api/names-to-tidy/tidy": (body) => {
        tidied.push(body);
        names = names.filter((name) => name.written !== (body as NameToTidy).written);
        return { body: { changed: 1 } };
      },
    });
    render(<TidyNames />);
    const list = await openList();

    await userEvent.click(within(list).getByRole("button", { name: "Tidy all" }));

    await expect
      .poll(() => tidied)
      .toEqual([
        { kind: "artist", written: JAY.written },
        { kind: "artist", written: BEATLES.written },
      ]);
    await expect.poll(() => within(list).queryAllByRole("listitem")).toHaveLength(0);
  });

  it("says why a name couldn't be tidied, beside it", async () => {
    serve({
      "GET /api/names-to-tidy": { body: { names: [JAY, BEATLES] } },
      "POST /api/names-to-tidy/tidy": {
        status: 404,
        body: { detail: "No Track shows “周杰伦2000年发行首张个人” any more." },
      },
    });
    render(<TidyNames />);
    const list = await openList();

    await userEvent.click(
      within(list).getByRole("button", { name: "Tidy 周杰伦2000年发行首张个人 to 周杰伦" }),
    );

    const alert = await within(list).findByRole("alert");
    expect(alert).toHaveTextContent("No Track shows");
    expect(within(list).getAllByRole("listitem")[0]).toContainElement(alert);
  });

  it("marks an album's name as an album's", async () => {
    const album: NameToTidy = {
      kind: "album",
      written: "八日目、雨が止む前に。(初回限定盤B)",
      name: "八日目、雨が止む前に。",
      year: null,
      fields: ["album"],
      track_ids: [31],
      years_differ: 0,
    };
    serve({ "GET /api/names-to-tidy": { body: { names: [JAY, album] } } });
    render(<TidyNames />);

    const list = await openList();

    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("Album");
  });
});
