import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PlayTime } from "./PlayTime";

describe("PlayTime", () => {
  it("sets the running time apart from the length it runs to", () => {
    const { container } = render(<PlayTime at={237} length={264} />);

    expect(container).toHaveTextContent("3:57 / 4:24");
    expect(container.querySelector(".time-at")).toHaveTextContent(/^3:57$/u);
    expect(container.querySelector(".time-length")).toHaveTextContent(/^\/ 4:24$/u);
  });

  it("keeps the slash from screen readers, and reads a word between them", () => {
    const slashed = render(<PlayTime at={237} length={264} />).container;
    const worded = render(<PlayTime at={237} length={2306} joiner="of" />).container;

    expect(slashed.querySelector("[aria-hidden]")).toHaveTextContent("/");
    expect(worded).toHaveTextContent("3:57 of 38:26");
    expect(worded.querySelector("[aria-hidden]")).toBeNull();
  });
});
