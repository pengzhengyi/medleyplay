import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Cover } from "./Cover";

const BREMEN = "5f3b6c9e0a1d2f4b8c7e6a5d4c3b2a1908f7e6d5c4b3a29180f7e6d5c4b3a291";

describe("a cover", () => {
  it("shows the image the cover names", () => {
    const { container } = render(<Cover cover={BREMEN} />);

    expect(container.querySelector("img")).toHaveAttribute("src", `/api/covers/${BREMEN}`);
  });

  it("shows a note in place of no cover", () => {
    const { container } = render(<Cover cover={null} />);

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("shows what it is given in place of no cover", () => {
    const { container } = render(<Cover cover={null}>M</Cover>);

    expect(container).toHaveTextContent("M");
  });

  it("shows the note once the image fails to load", () => {
    const { container } = render(<Cover cover={BREMEN} />);

    fireEvent.error(container.querySelector("img") ?? document.body);

    expect(container.querySelector("img")).toBeNull();
  });
});
