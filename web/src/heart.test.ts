import { describe, expect, it } from "vitest";

import { heartTitleOf } from "./heart";

describe("what the heart says on hover", () => {
  it("offers to add a song that isn't a favorite", () => {
    expect(heartTitleOf("Night Drive", false)).toBe("Add “Night Drive” to favorites");
  });

  it("says a favorite is one, and that a click removes it", () => {
    expect(heartTitleOf("Night Drive", true)).toBe("“Night Drive” is a favorite; click to remove");
  });
});
