import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { useSleepTimer } from "../player/useSleepTimer";
import { sleepTimerOf } from "../testing/player";
import { SleepTimerMenu } from "./SleepTimerMenu";

vi.mock("../useNow", () => ({ useNow: () => 12 * 60_000 }));

/** The menu over a real timer, pausing `pause`. */
function Timed({ pause }: { readonly pause: () => void }) {
  return <SleepTimerMenu timer={useSleepTimer(pause)} />;
}

describe("SleepTimerMenu", () => {
  it("offers times in words and keeps the active button icon only", async () => {
    render(<Timed pause={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Sleep timer" }));
    const offered = screen.getAllByRole("menuitem").map((item) => item.textContent);
    await userEvent.click(screen.getByRole("menuitem", { name: "30 minutes" }));

    expect(offered).toEqual(["15 minutes", "30 minutes", "45 minutes", "1 hour", "2 hours"]);
    const button = screen.getByRole("button", { name: "Sleep timer, on" });
    expect(button).toHaveTextContent(/^$/u);
    expect(button).toHaveClass("on");
  });

  it("shows remaining and set time on hover, keyboard focus, and in the menu", async () => {
    render(<SleepTimerMenu timer={sleepTimerOf({ setAt: 0, endsAt: 30 * 60_000 })} />);
    const user = userEvent.setup();
    const button = screen.getByRole("button", { name: "Sleep timer, on" });
    const remaining = "18 min left of 30 min";

    await user.hover(button);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(remaining);
    await user.unhover(button);
    await user.tab();
    expect(button).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(remaining);

    await user.keyboard("{Enter}");
    expect(within(screen.getByRole("menu")).getByText(remaining)).toBeVisible();
  });

  it("turns off from the same menu", async () => {
    render(<Timed pause={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Sleep timer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "1 hour" }));

    await userEvent.click(screen.getByRole("button", { name: "Sleep timer, on" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Turn off the timer" }));

    expect(screen.getByRole("button", { name: "Sleep timer" })).toBeVisible();
  });
});
