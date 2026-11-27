import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { setHoldForShortcuts } from "../holdForShortcuts";
import { openWithShortcuts, preferencesOf, serve } from "../testing/server";
import { ShortcutSettings } from "./ShortcutSettings";
import { LanguageSelect } from "./LanguageSelect";

/** The keys a command's row shows, as people read them. */
const keysShownFor = (name: string) =>
  within(screen.getByText(name).closest("li") ?? document.body)
    .queryAllByText(/./, { selector: "kbd" })
    .map((kbd) => kbd.textContent);

/** Render the section over a server keeping what it saves; return what it was sent. */
function renderSaving() {
  const { calls } = serve(preferencesOf());
  render(<ShortcutSettings />);
  return calls;
}

describe("changing the keyboard shortcuts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("translates a visible shortcut conflict without changing the binding or leaving capture", async () => {
    renderSaving();
    render(<LanguageSelect />);
    const user = userEvent.setup();
    const language = screen.getByRole("combobox", { name: "Language" });
    await user.click(screen.getByRole("button", { name: "Add keys to Shuffle" }));
    await user.keyboard("k");

    try {
      fireEvent.change(language, { target: { value: "zh-Hans" } });

      expect(screen.getByRole("status")).toHaveTextContent("K 已用于「播放或暂停」。请按其他键。");
      expect(keysShownFor("播放或暂停")).toEqual(["K"]);
      expect(screen.getByRole("button", { name: "按键以添加到「随机播放」" })).toHaveFocus();
    } finally {
      fireEvent.change(language, { target: { value: "auto" } });
    }
  });

  it("shows each command with its keys", () => {
    renderSaving();

    expect(keysShownFor("Play or pause")).toEqual(["K"]);
    expect(keysShownFor("Next song")).toEqual(["Shift + →"]);
    expect(keysShownFor("Next album")).toEqual(["]"]);
    expect(keysShownFor("Search")).toEqual(["G"]);
  });

  it("adds the next keys pressed to a command, and saves them with the Account", async () => {
    const calls = renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Add keys to Next song" }));
    await userEvent.keyboard("{Shift>}n{/Shift}");

    expect(keysShownFor("Next song")).toEqual(["Shift + →", "Shift + N"]);
    expect(screen.getByRole("status")).toHaveTextContent("Next song now also has Shift + N.");
    await waitFor(() => {
      expect(calls).toContain("PUT /api/me/preferences");
    });
  });

  it("does not claim or save a change when the command already has the key", async () => {
    const calls = renderSaving();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Add keys to Play or pause" }));

    await user.keyboard("k");

    expect(keysShownFor("Play or pause")).toEqual(["K"]);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(calls).not.toContain("PUT /api/me/preferences");
  });

  it("removes one of a command's keys, keeping the others", async () => {
    await openWithShortcuts({ toggle: ["space", "k"] });
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Remove K from Play or pause" }));

    expect(keysShownFor("Play or pause")).toEqual(["Space"]);
    expect(screen.getByRole("status")).toHaveTextContent("Play or pause no longer has K.");
  });

  it("says a command with no keys has none", async () => {
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Remove M from Mute or unmute" }));

    expect(
      within(screen.getByText("Mute or unmute").closest("li") ?? document.body).getByText("None"),
    ).toBeInTheDocument();
  });

  it("waits for a key while only a modifier is held", async () => {
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Add keys to Shuffle" }));
    await userEvent.keyboard("{Shift>}");

    expect(
      screen.getByRole("button", { name: "Press keys to add to Shuffle" }),
    ).toBeInTheDocument();
  });

  it("refuses keys another command has, naming it, and waits for others", async () => {
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Add keys to Shuffle" }));
    await userEvent.keyboard("k");

    expect(screen.getByRole("status")).toHaveTextContent("K is already Play or pause.");
    expect(keysShownFor("Shuffle")).toEqual(["S"]);
    expect(screen.getByRole("button", { name: "Press keys to add to Shuffle" })).toHaveFocus();
  });

  it("refuses keys the browser keeps, and waits for others", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Add keys to Shuffle" }));
    const recorder = screen.getByRole("button", { name: "Press keys to add to Shuffle" });
    const allowed = fireEvent.keyDown(recorder, { code: "KeyW", key: "w", metaKey: true });

    expect(allowed).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("The browser keeps ⌘ + W.");
    expect(recorder).toHaveFocus();
  });

  it("warns about a saved browser tab shortcut without removing the saved key", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    await openWithShortcuts({ nextAlbum: ["alt+meta+right"] });
    const calls = renderSaving();

    expect(screen.getByText(/Some saved shortcuts belong to the browser or system/u)).toBeVisible();
    expect(keysShownFor("Next album")).toEqual(["Alt + ⌘ + →"]);
    expect(calls).not.toContain("PUT /api/me/preferences");
  });

  it("leaves a produced slash to Firefox while recording", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Firefox/144.0");
    const calls = renderSaving();
    await userEvent.click(screen.getByRole("button", { name: "Add keys to Previous album" }));
    const recorder = screen.getByRole("button", { name: "Press keys to add to Previous album" });

    const allowed = fireEvent.keyDown(recorder, { code: "BracketLeft", key: "/" });

    expect(allowed).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("The browser keeps [.");
    expect(calls).not.toContain("PUT /api/me/preferences");
  });

  it("adds nothing on Escape", async () => {
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Add keys to Shuffle" }));
    await userEvent.keyboard("{Escape}");

    expect(keysShownFor("Shuffle")).toEqual(["S"]);
    expect(screen.getByRole("button", { name: "Add keys to Shuffle" })).toBeInTheDocument();
  });

  it("adds nothing on moving away", async () => {
    renderSaving();

    await userEvent.click(screen.getByRole("button", { name: "Add keys to Shuffle" }));
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    await userEvent.keyboard("j");

    expect(keysShownFor("Shuffle")).toEqual(["S"]);
    expect(screen.getByRole("button", { name: "Add keys to Shuffle" })).toHaveFocus();
  });

  it("says when the server didn't keep a change, which the page still uses", async () => {
    serve({ "PUT /api/me/preferences": { status: 503, body: { detail: "Busy" } } });
    render(<ShortcutSettings />);

    await userEvent.click(screen.getByRole("button", { name: "Remove K from Play or pause" }));

    expect(
      await screen.findByText(/Changed on this device but not saved to your account/u),
    ).toBeInTheDocument();
    expect(keysShownFor("Play or pause")).toEqual([]);
  });

  it("puts every command back on its usual keys", async () => {
    await openWithShortcuts({ toggle: ["j"] });
    render(<ShortcutSettings />);

    await userEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));

    expect(keysShownFor("Play or pause")).toEqual(["K"]);
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();
  });
});

describe("showing the shortcuts while the key is held", () => {
  afterEach(() => {
    setHoldForShortcuts(true);
  });

  it("is on, and turns off for this browser alone, without saving to the Account", async () => {
    const calls = renderSaving();
    const choice = screen.getByRole("checkbox", { name: /^Show them while .+ is held/ });
    const before = (choice as HTMLInputElement).checked;

    await userEvent.click(choice);

    expect(before).toBe(true);
    expect(choice).not.toBeChecked();
    expect(localStorage.getItem("medleyplay.holdForShortcuts")).toBe("off");
    expect(calls.filter((call) => !call.startsWith("GET"))).toEqual([]);
  });
});
