import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

/** Make the page's older copy command do `copy`. */
function stubCopyCommand(copy: () => boolean): void {
  Object.defineProperty(document, "execCommand", { value: copy, configurable: true });
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "execCommand");
});

describe("copying text", () => {
  it("writes it to the clipboard where the page may", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });

    const copied = await copyText("yt-dlp -f ba");

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledExactlyOnceWith("yt-dlp -f ba");
  });

  it("copies from a hidden text box where the page has no clipboard", async () => {
    vi.stubGlobal("navigator", {});
    let selected = "";
    stubCopyCommand(() => {
      selected = document.querySelector("textarea")?.value ?? "";
      return true;
    });

    const copied = await copyText("yt-dlp -f ba");

    expect([copied, selected, document.querySelector("textarea")]).toEqual([
      true,
      "yt-dlp -f ba",
      null,
    ]);
  });

  it("says when neither way worked", async () => {
    vi.stubGlobal("navigator", {});
    stubCopyCommand(() => false);

    expect(await copyText("yt-dlp -f ba")).toBe(false);
  });
});
