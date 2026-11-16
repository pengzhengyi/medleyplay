import { describe, expect, it } from "vitest";

import { likelyNameOf } from "./likelyName";

describe("the name a longer name likely is", () => {
  it("is the name it starts with, more written after it", () => {
    expect(likelyNameOf("告五人2019超强音质的", ["告五人", "痛仰乐队"])).toBe("告五人");
    expect(likelyNameOf("Jay Chou (Live 2004)", ["Jay Chou", "Jay"])).toBe("Jay Chou");
  });

  it("runs on into more words in a script written without spaces", () => {
    expect(likelyNameOf("痛仰乐队超强音质的", ["痛仰乐队"])).toBe("痛仰乐队");
  });

  it("is the longest name it starts with, compared folded, as the other is written", () => {
    expect(likelyNameOf("ｒｙｏ (supercell) 2010", ["ryo", "RYO (supercell)"])).toBe(
      "RYO (supercell)",
    );
  });

  it("is none where another artist is joined on, as in a duet", () => {
    const others = ["Michael Jackson", "周杰伦"];

    expect(likelyNameOf("Michael Jackson & Janet Jackson", others)).toBeUndefined();
    expect(likelyNameOf("Michael Jackson feat. Slash", others)).toBeUndefined();
    expect(likelyNameOf("Michael Jackson x Paul McCartney", others)).toBeUndefined();
    expect(likelyNameOf("周杰伦、费玉清", others)).toBeUndefined();
    expect(likelyNameOf("周杰伦和费玉清", others)).toBeUndefined();
  });

  it("is none where letters run on, as Jay runs into Jayson", () => {
    expect(likelyNameOf("Jayson", ["Jay"])).toBeUndefined();
  });

  it("is none for the name itself, or a name too short to tell", () => {
    expect(likelyNameOf("告五人", ["告五人"])).toBeUndefined();
    expect(likelyNameOf("A2019", ["A"])).toBeUndefined();
  });
});
