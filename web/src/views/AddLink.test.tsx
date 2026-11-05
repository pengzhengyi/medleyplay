import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AddedPart, LinkLookup, PartChoice } from "../api";
import { lookupOf, unreadableLookupOf } from "../testing/server";
import { AddLink } from "./AddLink";

const FIRST: AddedPart = { part: 1, track_id: 7, source_id: 70, job: null };

function renderDialog(lookup: LinkLookup | Error, link = "BV1Xx41117Tz") {
  const look = vi.fn(() =>
    lookup instanceof Error ? Promise.reject(lookup) : Promise.resolve(lookup),
  );
  const add = vi.fn((_link: string, _quality: string, parts: readonly PartChoice[]) =>
    Promise.resolve(parts.map((part) => ({ ...FIRST, part: part.part }))),
  );
  const onAdded = vi.fn();
  const onClose = vi.fn();
  render(<AddLink link={link} look={look} add={add} onAdded={onAdded} onClose={onClose} />);
  return {
    look,
    add,
    onAdded,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Add from Bilibili" }),
  };
}

describe("adding a video that was read", () => {
  it("looks the link up and suggests the video's title and uploader for its only part", async () => {
    const { look, dialog } = renderDialog(lookupOf(1));

    expect(await within(dialog).findByText("【MV】Night Drive")).toBeVisible();

    expect(look).toHaveBeenCalledExactlyOnceWith("BV1Xx41117Tz");
    expect(within(dialog).getByRole("textbox", { name: "Title of part 1" })).toHaveValue(
      "Night Drive",
    );
    expect(within(dialog).getByRole("textbox", { name: "Artist of part 1" })).toHaveValue(
      "Blue Room",
    );
  });

  it("adds the parts chosen under the titles and artists edited, at the quality chosen", async () => {
    const { add, onAdded, onClose, dialog } = renderDialog(lookupOf(3));
    await within(dialog).findByText("Mixtape");

    await userEvent.click(within(dialog).getByRole("checkbox", { name: "Part 2" }));
    const title = within(dialog).getByRole("textbox", { name: "Title of part 3" });
    await userEvent.clear(title);
    await userEvent.type(title, "Side C");
    await userEvent.selectOptions(
      within(dialog).getByRole("combobox", { name: "Quality" }),
      "30216",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Add 2 songs" }));

    expect(add).toHaveBeenCalledExactlyOnceWith("BV1Xx41117Tz", "30216", [
      { part: 1, title: "Mixtape 1", artist: "Blue Room" },
      { part: 3, title: "Side C", artist: "Blue Room" },
    ]);
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledExactlyOnceWith(2);
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows a part already added as added, and does not offer it again", async () => {
    const taken = lookupOf(2);
    const lookup = {
      ...taken,
      parts: taken.parts.map((part) => (part.part === 1 ? { ...part, track_id: 4 } : part)),
    };
    const { dialog } = renderDialog(lookup);

    await within(dialog).findByText("Mixtape");

    expect(within(dialog).getByRole("checkbox", { name: /Part 1/ })).toBeDisabled();
    expect(within(dialog).getByText("Already added")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("will not add a chosen part with no title", async () => {
    const { dialog } = renderDialog(lookupOf(1));
    await within(dialog).findByText("【MV】Night Drive");

    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Title of part 1" }));

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("says why when the server refuses, and stays open", async () => {
    const { add, onClose, dialog } = renderDialog(lookupOf(1));
    add.mockRejectedValueOnce(
      new Error("medleyplay is Offline, so links wait until it is Online."),
    );
    await within(dialog).findByText("【MV】Night Drive");

    await userEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("medleyplay is Offline");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("offers the other ways to get the file, folded, with the part's link filled in", async () => {
    const { dialog } = renderDialog(lookupOf(1));
    await within(dialog).findByText("【MV】Night Drive");

    const ways = within(dialog).getByRole("group");

    expect(ways).not.toHaveAttribute("open");
    expect(ways).toHaveTextContent("https://www.bilibili.com/video/BV1Xx41117Tz?p=1");
  });

  it("says why the link could not be looked up", async () => {
    const { dialog } = renderDialog(new Error("medleyplay can't add music from 'x'."));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("can't add music from");
  });
});

describe("adding a video that could not be read", () => {
  it("says why, and asks for one part's number, title, and artist", async () => {
    const { dialog } = renderDialog(
      unreadableLookupOf("Bilibili couldn't be reached.", "network", 2),
    );

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "The site couldn’t be reached. Bilibili couldn't be reached.",
    );

    expect(within(dialog).getByRole("spinbutton", { name: "Part number 1" })).toHaveValue(2);
    expect(within(dialog).getByRole("textbox", { name: "Title of part 1" })).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("adds the parts given at the best quality", async () => {
    const { add, onAdded, dialog } = renderDialog(unreadableLookupOf("Gone.", "gone"));
    await within(dialog).findByRole("alert");

    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Title of part 1" }),
      "Side A",
    );
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Artist of part 1" }),
      "Blue Room",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Add another part" }));
    await userEvent.type(
      within(dialog).getByRole("textbox", { name: "Title of part 2" }),
      "Side B",
    );
    await userEvent.click(within(dialog).getByRole("button", { name: "Add 2 songs" }));

    expect(add).toHaveBeenCalledExactlyOnceWith("BV1Xx41117Tz", "best", [
      { part: 1, title: "Side A", artist: "Blue Room" },
      { part: 2, title: "Side B", artist: "Blue Room" },
    ]);
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledExactlyOnceWith(2);
    });
  });

  it("will not add the same part number twice", async () => {
    const { dialog } = renderDialog(unreadableLookupOf("Gone.", "gone"));
    await within(dialog).findByRole("alert");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title of part 1" }), "A");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add another part" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Title of part 2" }), "B");

    const second = within(dialog).getByRole("spinbutton", { name: "Part number 2" });
    await userEvent.clear(second);
    await userEvent.type(second, "1");

    expect(within(dialog).getByRole("button", { name: "Add 2 songs" })).toBeDisabled();
  });

  it("removes a part added by mistake", async () => {
    const { dialog } = renderDialog(unreadableLookupOf("Gone.", "gone"));
    await within(dialog).findByRole("alert");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add another part" }));

    await userEvent.click(within(dialog).getByRole("button", { name: "Remove part 2" }));

    expect(within(dialog).queryByRole("textbox", { name: "Title of part 2" })).toBeNull();
  });
});
