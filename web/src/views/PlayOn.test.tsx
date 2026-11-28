import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../App";
import { FakeEventSource, stream } from "../testing/events";
import { fakeMedia } from "../testing/media";
import { type Routes, serve, signedIn, speakerStateOf, trackOf } from "../testing/server";
import { LanguageSelect } from "./LanguageSelect";

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
    stream().send("ready");
    stream().send("remote", { page: "host-page-0001", state: speakerStateOf(), age_ms: 0 });
  });
}

const player = () => screen.getByRole("region", { name: "Player" });

beforeEach(() => {
  vi.stubGlobal("EventSource", FakeEventSource);
});

afterEach(() => {
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
  FakeEventSource.last = undefined;
});

describe("Play on", () => {
  it("switches between independent queues without sending the computer a command", async () => {
    const { calls } = serve(
      phone({
        "POST /api/tracks/2/playback": {
          body: {
            state: "ready",
            audio_url: "/api/sources/2/audio",
            source_id: 2,
            media_type: "audio/mp4",
            start_ms: null,
            end_ms: null,
          },
        },
      }),
    );
    const { container } = render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Play on: this device" });
    const audio = container.querySelector("audio");
    if (audio === null) throw new Error("The player rendered no audio element.");
    fakeMedia(audio);
    computerPlaysLemon();
    await user.click(await screen.findByRole("button", { name: "Flamingo" }));
    await waitFor(() => {
      expect(within(player()).getByText("Flamingo")).toBeVisible();
      expect(audio.paused).toBe(false);
    });

    await user.click(screen.getByRole("button", { name: "Play on: this device" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Remote/u }));
    expect(within(player()).getByText("Lemon")).toBeVisible();
    expect(audio.paused).toBe(true);
    await user.click(screen.getByRole("button", { name: "Play on: the computer" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Client/u }));

    expect(within(player()).getByText("Flamingo")).toBeVisible();
    expect(audio.paused).toBe(true);
    expect(calls).not.toContain("POST /api/remote/commands");
  });

  it("keeps a Client station from adding songs to the computer when switching to Remote", async () => {
    const { calls } = serve(
      phone({ "GET /api/tracks": { body: [{ ...LEMON, favorite: true }, FLAMINGO] } }),
    );
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Radio" }));
    await user.click(await screen.findByRole("button", { name: "Play favorites" }));
    expect(await screen.findByText("Current station")).toBeVisible();
    computerPlaysLemon();

    await user.click(screen.getByRole("button", { name: "Play on: this device" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Remote/u }));

    expect(screen.queryByText("Current station")).not.toBeInTheDocument();
    expect(calls).not.toContain("POST /api/remote/commands");
    await user.click(screen.getByRole("button", { name: "Play on: the computer" }));
    await user.click(screen.getByRole("menuitemradio", { name: /^Client/u }));
    expect(screen.getByText("Current station")).toBeVisible();
  });

  it("shows the remote playback instruction in Chinese inside Now Playing", async () => {
    serve(phone());
    render(<App />);
    render(<LanguageSelect />);
    const user = userEvent.setup();
    const choose = await screen.findByRole("button", { name: "Play on: this device" });
    act(() => {
      stream().send("ready");
      stream().send("remote", {
        page: "host-page-0001",
        state: speakerStateOf({ status: "blocked" }),
        age_ms: 0,
      });
    });
    await user.click(choose);
    await user.click(screen.getByRole("menuitemradio", { name: /The computer/u }));
    await user.click(within(player()).getByRole("button", { name: "Open Now Playing" }));
    const dialog = await screen.findByRole("dialog", { name: "Now Playing" });
    const language = screen.getByRole("combobox", { name: "Language" });

    try {
      fireEvent.change(language, { target: { value: "zh-Hans" } });

      expect(within(dialog).getByText("请在电脑上点击一次以允许播放。")).toBeVisible();
    } finally {
      fireEvent.change(language, { target: { value: "auto" } });
    }
  });

  it("offers the computer only once medleyplay is open there", async () => {
    serve(phone());
    render(<App />);
    const user = userEvent.setup();

    const choice = await screen.findByRole("button", { name: "Play on: this device" });
    act(() => {
      stream().send("ready");
      stream().send("remote", { page: null, state: null, age_ms: null });
    });
    await user.click(choice);

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

  it.each([
    ["The computer hasn't caught up yet; try again in a moment.", "电脑仍在处理请求，请稍后重试。"],
    ["Search", "Search"],
  ])("keeps or translates the remote Pause refusal: %s", async (detail, shown) => {
    serve(phone({ "POST /api/remote/commands": { status: 429, body: { detail } } }));
    render(<App />);
    render(<LanguageSelect />);
    const user = userEvent.setup();
    const choose = await screen.findByRole("button", { name: "Play on: this device" });
    computerPlaysLemon();
    await user.click(choose);
    await user.click(screen.getByRole("menuitemradio", { name: /The computer/u }));
    await user.click(within(player()).getByRole("button", { name: "Pause" }));
    expect(await within(player()).findByRole("alert")).toHaveTextContent(detail);
    const language = screen.getByRole("combobox", { name: "Language" });

    try {
      fireEvent.change(language, { target: { value: "zh-Hans" } });

      expect(
        within(screen.getByRole("region", { name: "播放器" })).getByRole("alert").textContent,
      ).toBe(shown);
    } finally {
      fireEvent.change(language, { target: { value: "auto" } });
    }
  });

  it("says why the music couldn't move back here, and leaves it on the computer", async () => {
    serve(
      phone({
        "POST /api/remote/commands": {
          status: 429,
          body: { detail: "Too many commands waiting." },
        },
      }),
    );
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole("button", { name: "Play on: this device" });
    computerPlaysLemon();
    await user.click(screen.getByRole("button", { name: "Play on: this device" }));
    await user.click(screen.getByRole("menuitemradio", { name: /The computer/ }));

    await user.click(screen.getByRole("button", { name: "Play on: the computer" }));
    await user.click(screen.getByRole("menuitem", { name: /^Move playback/u }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Too many commands waiting.");
    expect(screen.getByRole("button", { name: "Play on: the computer" })).toBeInTheDocument();
  });

  it("keeps Remote selected when the speaker is lost", async () => {
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

    expect(screen.getByRole("button", { name: "Play on: the computer" })).toBeInTheDocument();
  });

  it("does not start local audio from a late handoff reply after the speaker is lost", async () => {
    let finish: () => void = () => {
      throw new Error("The handoff is not pending.");
    };
    const after = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { calls } = serve(phone({ "POST /api/remote/commands": { status: 204, after } }));
    render(<App />);
    const user = userEvent.setup();
    const choice = await screen.findByRole("button", { name: "Play on: this device" });
    computerPlaysLemon();
    await user.click(choice);
    await user.click(screen.getByRole("menuitemradio", { name: /^Remote/u }));
    await user.click(screen.getByRole("button", { name: "Play on: the computer" }));
    await user.click(screen.getByRole("menuitem", { name: /^Move playback/u }));
    expect(calls).toContain("POST /api/remote/commands");

    act(() => {
      stream().send("remote", { page: null, state: null, age_ms: null });
    });
    await act(async () => {
      finish();
      await after;
    });

    expect(screen.getByRole("button", { name: "Play on: the computer" })).toBeInTheDocument();
    expect(calls).not.toContain("POST /api/tracks/1/playback");
  });

  it("isn't offered on the computer itself", async () => {
    serve(signedIn([LEMON]));
    render(<App />);

    await screen.findByRole("button", { name: "Lemon" });

    expect(screen.queryByRole("button", { name: /Play on/ })).not.toBeInTheDocument();
  });
});
