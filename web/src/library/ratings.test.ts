import { describe, expect, it } from "vitest";

import { trackOf } from "../testing/server";
import { ratingOf } from "./ratings";

describe("your rating of a song", () => {
  it.each([
    [{ rating: 2, album_rating: 5 }, 2],
    [{ rating: null, album_rating: 5 }, 5],
    [{ rating: 3, album_rating: null }, 3],
    [{ rating: null, album_rating: null }, null],
  ])("is your own, else your album's: %o", (change, rating) => {
    expect(ratingOf(trackOf(1, "Intro", change))).toBe(rating);
  });
});
