import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { serve } from "../testing/server";
import { StorageFolderLocation } from "./StorageFolderLocation";

const FOLDER = "GET /api/storage/folder";
const SHOW = "POST /api/storage/folder/show";
const PATH = "~/Library/Application Support/medleyplay/downloads";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Downloads folder", () => {
  it("says where the Downloads are kept, and copies the path", async () => {
    serve({ [FOLDER]: { body: { path: PATH, can_show: false } } });
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render(<StorageFolderLocation />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy the folder's path" }));

    expect(screen.getByText(PATH)).toBeVisible();
    expect(writeText).toHaveBeenCalledWith(PATH);
    expect(screen.getByRole("status")).toHaveTextContent("Copied");
  });

  it("offers no Show in Finder where the server says it can't", async () => {
    serve({ [FOLDER]: { body: { path: PATH, can_show: false } } });
    render(<StorageFolderLocation />);

    await screen.findByText(PATH);

    expect(screen.queryByRole("button", { name: "Show in Finder" })).toBeNull();
  });

  it("has Finder show the folder for an admin on the server's Mac", async () => {
    const shown: unknown[] = [];
    serve({
      [FOLDER]: { body: { path: PATH, can_show: true } },
      [SHOW]: () => {
        shown.push(SHOW);
        return { status: 204 };
      },
    });
    render(<StorageFolderLocation />);

    await userEvent.click(await screen.findByRole("button", { name: "Show in Finder" }));

    expect(shown).toEqual([SHOW]);
  });

  it("says why Finder could not show it", async () => {
    serve({
      [FOLDER]: { body: { path: PATH, can_show: true } },
      [SHOW]: { status: 409, body: { detail: "Finder could not show the Downloads folder." } },
    });
    render(<StorageFolderLocation />);

    await userEvent.click(await screen.findByRole("button", { name: "Show in Finder" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Finder could not show the Downloads folder.",
    );
  });
});
