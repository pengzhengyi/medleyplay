import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiAsk } from "../api";
import { serve, settingsOf } from "../testing/server";
import { AiNotePanel } from "./AiNotePanel";

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
});
