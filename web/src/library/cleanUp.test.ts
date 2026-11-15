import { describe, expect, it } from "vitest";

import { inOrderOfWaiting } from "./cleanUp";

describe("the order of Clean up's sections", () => {
  it("puts the sections with names waiting first, and those done last, each as it was", () => {
    const sections = [
      { id: "link", waiting: 0 },
      { id: "tidy", waiting: 3 },
      { id: "split", waiting: 0 },
      { id: "covers", waiting: 1 },
    ];

    expect(inOrderOfWaiting(sections).map((section) => section.id)).toEqual([
      "tidy",
      "covers",
      "link",
      "split",
    ]);
  });
});
