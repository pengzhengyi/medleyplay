import { afterEach, describe, expect, it } from "vitest";

import { chooseDynamics, savedDynamics } from "./dynamics";

afterEach(() => {
  localStorage.clear();
});

describe("Dynamics", () => {
  it("flows until a browser chooses otherwise", () => {
    expect(savedDynamics()).toBe("flow");
  });

  it("remembers the effect chosen, or none", () => {
    chooseDynamics("mesh");
    const mesh = savedDynamics();
    chooseDynamics("off");

    expect(mesh).toBe("mesh");
    expect(savedDynamics()).toBe("off");
  });

  it("ignores a saved value it doesn't know", () => {
    localStorage.setItem("medleyplay.dynamics", "lava");

    expect(savedDynamics()).toBe("flow");
  });
});
