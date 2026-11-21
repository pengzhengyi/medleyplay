import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { applyTheme } from "./theme";

/** The inline script of `index.html`, which runs before the app's own script. */
function startingScript(): string {
  // Tests run from `web/`, where the page lives.
  const page = readFileSync(join(process.cwd(), "index.html"), "utf8");
  const parsed = new DOMParser().parseFromString(page, "text/html");
  const inline = [...parsed.scripts].find((script) => script.src === "");
  if (inline === undefined) {
    throw new Error("index.html has no inline script.");
  }
  return inline.text;
}

/** Run the page's inline script as the browser does before the first paint. */
function startPage(): void {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the page's own script, under test
  const run = new Function(startingScript()) as () => void;
  run();
}

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

describe("the page before its script runs", () => {
  it.each(["light", "dark"] as const)("shows the %s theme this browser chose", (theme) => {
    applyTheme(theme);
    delete document.documentElement.dataset.theme;

    startPage();

    expect(document.documentElement.dataset.theme).toBe(theme);
  });

  it("follows the system when this browser chose it, or nothing", () => {
    applyTheme("system");

    startPage();

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("ignores a value it does not know", () => {
    localStorage.setItem("medleyplay.theme", "sepia");

    startPage();

    expect(document.documentElement.dataset.theme).toBeUndefined();
  });
});
