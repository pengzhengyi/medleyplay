import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { FakeEventSource, stream } from "../testing/events";
import { type Routes, serve, signedIn, speakerStateOf, trackOf } from "../testing/server";

const LEMON = trackOf(1, "Lemon");
const FLAMINGO = trackOf(2, "Flamingo");

/** A phone on the LAN, signed in, holding Lemon and Flamingo. */
function phone(routes: Routes = {}): Routes {
  return {
    ...signedIn([LEMON, FLAMINGO]),
    "GET /api/device": { body: { presence: "allowed", label: "Safari on iPhone", code: null } },
    ...routes,
  };
}

/** The computer playing Lemon, as the event stream says. */
function computerPlaysLemon() {
  act(() => {
    stream().send("remote", { page: "host-page-0001", state: speakerStateOf(), age_ms: 0 });
  });
}

const player = () => screen.getByRole("region", { name: "Player" });

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

describe("Play on", () => {
  it("offers the computer only once medleyplay is open there", async () => {
    serve(phone());
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Play on: this device" }));

    const computer = screen.getByRole("menuitemradio", { name: /The computer/ });
    expect(computer).toHaveAttribute("aria-disabled", "true");
    expect(computer).toHaveTextContent("Open medleyplay on the computer");
  });

  it("shows what the computer plays once chosen", async () => {
    serve(phone());
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Play on: this device" });
    computerPlaysLemon();

    await user.click(screen.getByRole("button", { name: "Play on: this device" }));
    await user.click(screen.getByRole("menuitemradio", { name: /The computer/ }));

    expect(screen.getByRole("button", { name: "Play on: the computer" })).toBeInTheDocument();
    expect(within(player()).getByText("Lemon")).toBeInTheDocument();
    expect(within(player()).getByRole("button", { name: "Pause" })).toBeEnabled();
  });

  it("asks the computer to pause from the phone", async () => {
    const sent: unknown[] = [];
    serve(
      phone({
        "POST /api/remote/commands": (body) => {
          sent.push((body as { command: unknown }).command);
          return { status: 204 };
        },
      }),
    );
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Play on: this device" });
    computerPlaysLemon();
    await user.click(screen.getByRole("button", { name: "Play on: this device" }));
    await user.click(screen.getByRole("menuitemradio", { name: /The computer/ }));

    await user.click(within(player()).getByRole("button", { name: "Pause" }));

    expect(within(player()).getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(sent).toEqual([{ kind: "toggle" }]);
  });

  it("plays here again once the computer stops playing for the Account", async () => {
    serve(phone());
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Play on: this device" });
    computerPlaysLemon();
    await user.click(screen.getByRole("button", { name: "Play on: this device" }));
    await user.click(screen.getByRole("menuitemradio", { name: /The computer/ }));

    act(() => {
      stream().send("remote", { page: null, state: null, age_ms: null });
    });

    expect(screen.getByRole("button", { name: "Play on: this device" })).toBeInTheDocument();
  });

  it("isn't offered on the computer itself", async () => {
    serve(signedIn([LEMON]));
    render(<App />);

    await screen.findByRole("button", { name: "Lemon" });

    expect(screen.queryByRole("button", { name: /Play on/ })).not.toBeInTheDocument();
  });
});
