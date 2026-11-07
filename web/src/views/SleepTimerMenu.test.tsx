import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useSleepTimer } from "../player/useSleepTimer";
import { SleepTimerMenu } from "./SleepTimerMenu";

/** The menu over a real timer, pausing `pause`. */
function Timed({ pause }: { readonly pause: () => void }) {
  return <SleepTimerMenu timer={useSleepTimer(pause)} />;
}

describe("SleepTimerMenu", () => {
  it("offers times in words, then shows the time left once one is chosen", async () => {
    render(<Timed pause={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Sleep timer" }));
    const offered = screen.getAllByRole("menuitem").map((item) => item.textContent);
    await userEvent.click(screen.getByRole("menuitem", { name: "30 minutes" }));

    expect(offered).toEqual(["15 minutes", "30 minutes", "45 minutes", "1 hour", "2 hours"]);
    expect(
      screen.getByRole("button", { name: /^Sleep timer, 30 min left: pauses at / }),
    ).toHaveTextContent("30 min");
  });

  it("turns off from the same menu", async () => {
    render(<Timed pause={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sleep timer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "1 hour" }));

    await userEvent.click(screen.getByRole("button", { name: /^Sleep timer, / }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Turn off the timer" }));

    expect(screen.getByRole("button", { name: "Sleep timer" })).toBeVisible();
  });
});
