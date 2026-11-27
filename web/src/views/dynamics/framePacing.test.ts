import { describe, expect, it } from "vitest";

import { framePacing } from "./framePacing";

describe("Dynamics frame pacing", () => {
  it("detects repeated slow frames even when fast frames interrupt them", () => {
    const pacing = framePacing();
    const intervals = Array.from({ length: 16 }, (_, index) => (index % 4 === 3 ? 33 : 83));
    let now = 0;
    expect(pacing.slowAt(now)).toBe(false);
    const results = intervals.map((interval) => pacing.slowAt((now += interval)));

    expect(results).toEqual([...Array<boolean>(15).fill(false), true]);
  });

  it("lets sporadic slow frames age out without switching", () => {
    const pacing = framePacing();
    let now = 0;
    pacing.slowAt(now);
    const results = Array.from({ length: 80 }, (_, index) =>
      pacing.slowAt((now += index % 8 === 0 ? 150 : 17)),
    );

    expect(results).not.toContain(true);
  });

  it("does not count the time between active periods or carry over older samples", () => {
    const pacing = framePacing();
    let now = 0;
    pacing.slowAt(now);
    for (let index = 0; index < 15; index++) pacing.slowAt((now += 83));

    pacing.reset();
    now += 10_000;
    const results = [pacing.slowAt(now)];
    for (let index = 0; index < 15; index++) results.push(pacing.slowAt((now += 83)));

    expect(results).not.toContain(true);
    expect(pacing.slowAt(now + 83)).toBe(true);
  });
});
