import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { AddedPart, LinkLookup, VideoChoices } from "../api";
import { lookupOf, unreadableLookupOf } from "../testing/server";
import { AddLink } from "./AddLink";

const FIRST: AddedPart = { part: 1, track_id: 7, source_id: 70, job: null };

function renderDialog(lookup: LinkLookup | Error) {
  const load = vi.fn();
  const opening =
    lookup instanceof Error
      ? Promise.reject(lookup)
      : Promise.resolve({
          id: 8,
          state: "succeeded" as const,
          label: "Night Drive",
          message: "",
          result: lookup,
        });
  const add = vi.fn((_id: number, _quality: string, parts: VideoChoices) =>
    Promise.resolve(
      "mode" in parts ? [FIRST] : parts.map((part) => ({ ...FIRST, part: part.part })),
    ),
  );
  const onAdded = vi.fn();
  const onClose = vi.fn();
  render(
    <AddLink
      opening={opening}
      listed={[]}
      load={load}
      add={add}
      onAdded={onAdded}
      onClose={onClose}
    />,
  );
  return {
    load,
    add,
    onAdded,
    onClose,
    dialog: screen.getByRole("dialog", { name: "Add from Bilibili" }),
  };
}

async function manual(lookup: LinkLookup) {
  const opened = renderDialog(lookup);
  await userEvent.click(
    await within(opened.dialog).findByRole("checkbox", { name: "Edit titles and artists" }),
  );
  return opened;
}

describe("adding a video that was read", () => {
  it("clears every selection and downloads only the edited part selected again", async () => {
    const { add, dialog } = await manual(lookupOf(3));
    const form = within(dialog);
    await userEvent.clear(form.getByLabelText("Title of part 2"));
    await userEvent.type(form.getByLabelText("Title of part 2"), "Side B");
    await userEvent.clear(form.getByLabelText("Artist of part 2"));
    await userEvent.type(form.getByLabelText("Artist of part 2"), "Trio");
    await userEvent.click(form.getByRole("button", { name: "Deselect all" }));
    expect(form.getByRole("button", { name: "Add" })).toBeDisabled();
    await userEvent.click(form.getByRole("checkbox", { name: "Part 2" }));
    expect(add).not.toHaveBeenCalled();
    await userEvent.click(form.getByRole("button", { name: "Add" }));

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "best", [
      { part: 2, title: "Side B", artist: "Trio" },
    ]);
  });

  it("selects all eligible parts from a partial selection without adding or selecting taken parts", async () => {
    const lookup = lookupOf(3);
    const { add, dialog } = await manual({
      ...lookup,
      parts: lookup.parts.map((p) => (p.part === 2 ? { ...p, track_id: 12 } : p)),
    });
    const form = within(dialog);
    await userEvent.click(form.getByRole("checkbox", { name: "Part 3" }));
    await userEvent.click(form.getByRole("button", { name: "Select all" }));

    expect(form.getByRole("checkbox", { name: /Part 2/ })).not.toBeChecked();
    expect(form.getByRole("checkbox", { name: /Part 2/ })).toBeDisabled();
    expect(form.getByRole("checkbox", { name: "Part 1" })).toBeChecked();
    expect(form.getByRole("checkbox", { name: "Part 3" })).toBeChecked();
    expect(add).not.toHaveBeenCalled();
  });

  it("downloads a whole upload without editing parts or automatically adding it", async () => {
    const { add, dialog } = renderDialog(lookupOf(1));
    const download = await within(dialog).findByRole("button", { name: "Download 1 file" });

    expect(add).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(download);

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "best", { mode: "download", parts: [1] });
  });

  it("downloads only the selected files without needing song details", async () => {
    const { add, dialog } = renderDialog(lookupOf(3));
    const form = within(dialog);

    await userEvent.click(await form.findByRole("checkbox", { name: "Part 1: Mixtape 1" }));
    await userEvent.click(form.getByRole("button", { name: "Download 2 files" }));

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "best", { mode: "download", parts: [2, 3] });
  });

  it("selects and submits every eligible part of a sixty-part video at once", async () => {
    const parts = 60;
    const { add, dialog } = renderDialog(lookupOf(parts));
    const form = within(dialog);

    await userEvent.click(await form.findByRole("button", { name: "Deselect all" }));
    await userEvent.click(form.getByRole("button", { name: "Select all" }));
    expect(form.getByRole("status")).toHaveTextContent("60 of 60 selected");
    await userEvent.click(form.getByRole("button", { name: "Download 60 files" }));

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "best", {
      mode: "download",
      parts: Array.from({ length: parts }, (_, index) => index + 1),
    });
  });

  it("joins only the chosen parts, keeping selections when switching file layouts", async () => {
    const lookup = lookupOf(3);
    const { add, dialog, onAdded } = renderDialog({
      ...lookup,
      parts: lookup.parts.map((part) => (part.part === 2 ? { ...part, track_id: 12 } : part)),
    });
    const form = within(dialog);
    const first = await form.findByRole("checkbox", { name: "Part 1: Mixtape 1" });
    const second = form.getByRole("checkbox", { name: "Part 2: Mixtape 2" });
    await userEvent.click(first);
    expect(second).toBeDisabled();
    await userEvent.click(form.getByRole("radio", { name: "One album file" }));
    expect(first).not.toBeChecked();
    expect(second).not.toBeChecked();
    await userEvent.click(second);
    await userEvent.click(form.getByRole("radio", { name: "Separate files" }));
    expect(second).not.toBeChecked();
    expect(second).toBeDisabled();
    await userEvent.click(form.getByRole("radio", { name: "One album file" }));
    expect(second).toBeChecked();
    expect(form.queryByText("Other ways to get the file")).not.toBeInTheDocument();
    await userEvent.click(form.getByRole("button", { name: "Download 1 album file" }));

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "best", {
      mode: "joined",
      album: "Mixtape",
      artist: "",
      parts: [2, 3],
    });
    await waitFor(() => {
      expect(onAdded).toHaveBeenCalledExactlyOnceWith(1, {
        view: "library",
        focus: FIRST.track_id,
      });
    });
  });

  it("keeps the selection when grouping the chosen files under an album title and artist", async () => {
    const { add, dialog } = renderDialog(lookupOf(3));
    const form = within(dialog);
    await userEvent.click(await form.findByRole("checkbox", { name: "Part 1: Mixtape 1" }));
    await userEvent.click(
      form.getByRole("checkbox", { name: "Group these separate files in one album" }),
    );
    expect(form.getByRole("checkbox", { name: "Part 1: Mixtape 1" })).not.toBeChecked();
    const album = within(dialog).getByLabelText("Album title");
    expect(album).toHaveValue("Mixtape");
    expect(within(dialog).getByLabelText("Album artist")).toHaveValue("");
    await userEvent.clear(album);
    await userEvent.type(album, "Live");
    await userEvent.type(within(dialog).getByLabelText("Album artist"), "The Trio");
    await userEvent.selectOptions(within(dialog).getByLabelText("Quality"), "30216");
    await userEvent.click(within(dialog).getByRole("button", { name: "Download 2 files" }));

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "30216", {
      mode: "album",
      album: "Live",
      artist: "The Trio",
      parts: [2, 3],
    });
  });

  it("suggests the saved video's title and uploader without requesting the parts again", async () => {
    const { load, dialog } = await manual(lookupOf(1));

    expect(await within(dialog).findByText("【MV】Night Drive")).toBeVisible();

    expect(load).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("textbox", { name: "Title of part 1" })).toHaveValue(
      "Night Drive",
    );
    expect(within(dialog).getByRole("textbox", { name: "Artist of part 1" })).toHaveValue(
      "Blue Room",
    );
  });

  it("adds the parts chosen under the titles and artists edited, at the quality chosen", async () => {
    const { add, onAdded, onClose, dialog } = await manual(lookupOf(3));
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

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "30216", [
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
    const { dialog } = await manual(lookup);

    await within(dialog).findByText("Mixtape");

    expect(within(dialog).getByRole("checkbox", { name: /Part 1/ })).toBeDisabled();
    expect(within(dialog).getByText("Already added")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Add" })).toBeEnabled();
  });

  it("names the fields above the first part that has them, the parts below lined up under them", async () => {
    const taken = lookupOf(3);
    const lookup = {
      ...taken,
      parts: taken.parts.map((part) => (part.part === 1 ? { ...part, track_id: 4 } : part)),
    };
    const { dialog } = await manual(lookup);
    await within(dialog).findByText("Mixtape");

    const shown = (name: string) =>
      within(dialog)
        .getAllByText(name)
        .map((label) => !label.classList.contains("visually-hidden"));

    expect(shown("Title")).toEqual([true, false]);
    expect(shown("Artist")).toEqual([true, false]);
  });

  it("will not add a chosen part with no title", async () => {
    const { dialog } = await manual(lookupOf(1));
    await within(dialog).findByText("【MV】Night Drive");

    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Title of part 1" }));

    expect(within(dialog).getByRole("button", { name: "Add" })).toBeDisabled();
  });

  it("says why when the server refuses, and stays open", async () => {
    const { add, onClose, dialog } = await manual(lookupOf(1));
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

    const ways = within(dialog).getByText("Other ways to get the file").closest("details");

    expect(ways).not.toBeNull();
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

  it("shows what goes in each of a part's empty fields", async () => {
    const { dialog } = renderDialog(unreadableLookupOf("Bilibili couldn't be reached.", "network"));

    await within(dialog).findByRole("alert");

    expect(within(dialog).getByRole("spinbutton", { name: "Part number 1" })).toHaveAttribute(
      "placeholder",
      "Part",
    );
    expect(within(dialog).getByRole("textbox", { name: "Title of part 1" })).toHaveAttribute(
      "placeholder",
      "Title",
    );
    expect(within(dialog).getByRole("textbox", { name: "Artist of part 1" })).toHaveAttribute(
      "placeholder",
      "Artist",
    );
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

    expect(add).toHaveBeenCalledExactlyOnceWith(8, "best", [
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
