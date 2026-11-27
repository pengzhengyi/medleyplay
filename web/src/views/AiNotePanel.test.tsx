import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiAsk } from "../api";
import { serve, settingsOf } from "../testing/server";
import { AiNotePanel } from "./AiNotePanel";
import { LanguageSelect } from "./LanguageSelect";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

/** Open the panel for `ask` over the household's notes; return it and what it asked. */
async function opened(ask: AiAsk) {
  serve({ "GET /api/settings": { body: settingsOf() } });
  const onAsk = vi.fn();
  const onClose = vi.fn();
  const { unmount } = render(<AiNotePanel ask={ask} onAsk={onAsk} onClose={onClose} />);
  const panel = screen.getByRole("group", { name: "Ask AI with a note" });
  await within(panel).findAllByRole("checkbox");
  return { panel, onAsk, onClose, unmount };
}

describe("the note to ask the AI with", () => {
  it("translates guidance and the character count without changing the notes sent", async () => {
    const { panel, onAsk } = await opened("songs");
    render(<LanguageSelect />);
    const language = screen.getByRole("combobox", { name: "Language" });
    const user = userEvent.setup();

    try {
      await user.selectOptions(language, "zh-Hans");
      const note = "A live album: leave out the talking between songs.";
      await user.click(within(panel).getByRole("checkbox", { name: note }));
      const details = within(panel).getByRole("textbox", { name: "补充详情" });
      await user.type(details, "22 首歌");

      expect(panel).toHaveAccessibleName("附带备注询问 AI");
      expect(details).toHaveAccessibleDescription(/将发送 \d+ 个字符，最多 500 个/u);
      expect(within(panel).getByText(/此浏览器可记住提交的补充详情/u)).toBeVisible();
      await user.click(within(panel).getByRole("button", { name: "询问 AI" }));
      expect(onAsk).toHaveBeenCalledWith(`${note}\n22 首歌`);
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("offers the household's notes for its ask, and not the other ask's", async () => {
    const { panel } = await opened("songs");

    expect(within(panel).getAllByRole("checkbox")).toHaveLength(2);
    expect(
      within(panel).getByRole("checkbox", {
        name: "One song per track of the album's standard edition.",
      }),
    ).not.toBeChecked();
    expect(
      within(panel).getByRole("checkbox", {
        name: "A live album: leave out the talking between songs.",
      }),
    ).not.toBeChecked();
  });

  it("reports unread household notes while still sending manually typed details", async () => {
    serve({ "GET /api/settings": { status: 503 } });
    const onAsk = vi.fn();
    const user = userEvent.setup();
    render(<AiNotePanel ask="details" onAsk={onAsk} onClose={vi.fn()} />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Could not read the household's notes. You can still type details below.",
    );
    await user.type(screen.getByRole("textbox", { name: "More details" }), "1989");
    await user.click(screen.getByRole("button", { name: "Ask AI" }));

    expect(onAsk).toHaveBeenCalledWith("1989");
  });

  it("asks with each note ticked and the details typed, one to a line", async () => {
    const { panel, onAsk } = await opened("songs");
    const user = userEvent.setup();

    await user.click(within(panel).getByRole("checkbox", { name: /live album/u }));
    await user.type(within(panel).getByRole("textbox", { name: "More details" }), "22 songs");
    await user.click(within(panel).getByRole("button", { name: "Ask AI" }));

    expect(onAsk).toHaveBeenCalledWith(
      "A live album: leave out the talking between songs.\n22 songs",
    );
  });

  it("remembers the details typed in this browser for the next time", async () => {
    const first = await opened("details");
    const user = userEvent.setup();
    await user.type(within(first.panel).getByRole("textbox", { name: "More details" }), "1989");
    await user.click(within(first.panel).getByRole("button", { name: "Ask AI" }));
    first.unmount();

    const second = await opened("details");

    expect(within(second.panel).getByRole("textbox", { name: "More details" })).toHaveValue("1989");
  });

  it.each([false, true])(
    "clears and forgets the previous prompt without sending it (field already empty: %s)",
    async (empty) => {
      const first = await opened("songs");
      const user = userEvent.setup();
      await user.type(
        within(first.panel).getByRole("textbox", { name: "More details" }),
        "22 songs",
      );
      await user.click(within(first.panel).getByRole("button", { name: "Ask AI" }));
      first.unmount();
      const second = await opened("songs");
      const panel = within(second.panel);
      const details = panel.getByRole("textbox", { name: "More details" });
      const note = panel.getByRole("checkbox", { name: /live album/u });
      expect(details).toHaveValue("22 songs");
      await user.click(note);
      if (empty) await user.clear(details);

      await user.click(panel.getByRole("button", { name: "Clear details" }));

      expect(details).toHaveValue("");
      expect(details).toHaveFocus();
      expect(note).toBeChecked();
      expect(second.onAsk).not.toHaveBeenCalled();
      second.unmount();
      const reopened = await opened("songs");
      expect(within(reopened.panel).getByRole("textbox", { name: "More details" })).toHaveValue("");
    },
  );

  it("clears the field and explains when the browser refuses to forget the saved prompt", async () => {
    const first = await opened("details");
    const user = userEvent.setup();
    await user.type(within(first.panel).getByRole("textbox", { name: "More details" }), "1989");
    await user.click(within(first.panel).getByRole("button", { name: "Ask AI" }));
    first.unmount();
    const second = await opened("details");
    const panel = within(second.panel);
    const forget = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable.", "SecurityError");
    });

    try {
      await user.click(panel.getByRole("button", { name: "Clear details" }));
      expect(panel.getByRole("textbox", { name: "More details" })).toHaveValue("");
      expect(panel.getByRole("alert")).toHaveTextContent(
        "Cleared here, but this browser did not forget the saved details.",
      );
      expect(panel.getByRole("button", { name: "Clear details" })).toBeEnabled();
      expect(second.onAsk).not.toHaveBeenCalled();
    } finally {
      forget.mockRestore();
    }
  });

  it("counts the characters sent, and asks nothing over the limit", async () => {
    const { panel, onAsk } = await opened("details");
    const user = userEvent.setup();

    await user.click(within(panel).getByRole("checkbox", { name: /first came out/u }));
    await user.click(within(panel).getByRole("textbox", { name: "More details" }));
    await user.paste("x".repeat(480));

    expect(within(panel).getByText(/of 500 characters/u)).toHaveTextContent(
      "523 of 500 characters",
    );
    expect(within(panel).getByRole("button", { name: "Ask AI" })).toBeDisabled();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("closes on Escape without asking", async () => {
    const { onAsk, onClose } = await opened("details");

    await userEvent.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("leaves the draft open and does not ask while confirming or canceling IME input", async () => {
    const { panel, onAsk, onClose } = await opened("details");
    const field = within(panel).getByRole("textbox", { name: "More details" });
    fireEvent.change(field, { target: { value: "现场" } });

    fireEvent.keyDown(field, { key: "Enter", keyCode: 229 });
    fireEvent.keyDown(field, { key: "Escape", isComposing: true });

    expect(onAsk).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(field).toHaveValue("现场");
  });

  it("still submits details when this browser refuses to read and write its saved draft", async () => {
    const read = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable.", "SecurityError");
    });
    const write = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full.", "QuotaExceededError");
    });

    try {
      const { panel, onAsk } = await opened("details");
      const user = userEvent.setup();
      const field = within(panel).getByRole("textbox", { name: "More details" });
      expect(field).toHaveValue("");
      await user.type(field, "1989");
      await user.click(within(panel).getByRole("button", { name: "Ask AI" }));

      expect(onAsk).toHaveBeenCalledWith("1989");
    } finally {
      read.mockRestore();
      write.mockRestore();
    }
  });

  it("allows 500 supplementary Chinese characters and refuses 501", async () => {
    const { panel, onAsk } = await opened("details");
    const field = within(panel).getByRole("textbox", { name: "More details" });
    const submit = within(panel).getByRole("button", { name: "Ask AI" });
    const atLimit = "𠮷".repeat(500);
    fireEvent.change(field, { target: { value: `${atLimit}𠮷` } });

    expect(submit).toBeDisabled();
    fireEvent.change(field, { target: { value: atLimit } });
    expect(field).toHaveAccessibleDescription("500 of 500 characters");
    await userEvent.click(submit);

    expect(onAsk).toHaveBeenCalledWith(atLimit);
  });
});
