import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProxySetting } from "../api";
import { type Routes, serve } from "../testing/server";
import { BilibiliSettings } from "./BilibiliSettings";

/** A proxy with a login, as the server shows it: its address, never the login. */
const WITH_LOGIN: ProxySetting = {
  scheme: "socks5h",
  host: "127.0.0.1",
  port: 7890,
  has_login: true,
  display: "socks5h://127.0.0.1:7890",
  saved_at: "2026-11-04T09:00:00Z",
};

const WITHOUT_LOGIN: ProxySetting = {
  ...WITH_LOGIN,
  scheme: "http",
  port: 3128,
  has_login: false,
  display: "http://127.0.0.1:3128",
};

function open(proxy: ProxySetting | null, routes: Routes = {}) {
  const served = serve({ "GET /api/proxies/bilibili": { body: proxy }, ...routes });
  render(<BilibiliSettings />);
  return served;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the Bilibili proxy", () => {
  it("says a site with no proxy is reached directly", async () => {
    open(null);

    expect(
      await screen.findByText("No proxy is set, so Bilibili is reached directly."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove proxy" })).toBeNull();
  });

  it("shows the address and that the proxy has a login, never the login", async () => {
    open(WITH_LOGIN);

    expect(await screen.findByText("socks5h://127.0.0.1:7890")).toBeInTheDocument();
    expect(screen.getByText(/with a login/)).toBeInTheDocument();
  });

  it("shows a proxy without a login without saying it has one", async () => {
    open(WITHOUT_LOGIN);

    expect(await screen.findByText("http://127.0.0.1:3128")).toBeInTheDocument();
    expect(screen.queryByText(/with a login/)).toBeNull();
  });

  it("takes the URL in a password field and says it is kept in the Keychain and never shown again", async () => {
    open(null);

    const field = await screen.findByLabelText("Proxy URL");

    expect(field).toHaveAttribute("type", "password");
    expect(screen.getByText(/kept in the Keychain and never shown again/)).toBeInTheDocument();
  });

  it("has no button to test the proxy", async () => {
    open(WITH_LOGIN);

    await screen.findByText("socks5h://127.0.0.1:7890");

    expect(screen.queryByRole("button", { name: /test/i })).toBeNull();
  });

  it("saves the URL as typed, clears the field, and shows the new address", async () => {
    let saved: unknown;
    let answer: ProxySetting | null = null;
    const routes: Routes = {
      "GET /api/proxies/bilibili": () => ({ body: answer }),
      "PUT /api/proxies/bilibili": (body) => {
        saved = body;
        answer = WITH_LOGIN;
        return { body: WITH_LOGIN };
      },
    };
    const user = userEvent.setup();
    open(null, routes);
    const field = await screen.findByLabelText("Proxy URL");

    await user.type(field, "  socks5h://alice:swordfish@127.0.0.1:7890  ");
    await user.click(screen.getByRole("button", { name: "Save proxy" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(saved).toEqual({ url: "socks5h://alice:swordfish@127.0.0.1:7890" });
    expect(screen.getByLabelText("New proxy URL")).toHaveValue("");
    expect(screen.getByText("socks5h://127.0.0.1:7890")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("swordfish");
  });

  it("does not offer to save a blank URL", async () => {
    open(null);

    await screen.findByLabelText("Proxy URL");

    expect(screen.getByRole("button", { name: "Save proxy" })).toBeDisabled();
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    const user = userEvent.setup();
    open(null, {
      "PUT /api/proxies/bilibili": {
        status: 422,
        body: { detail: "Use socks5h, which looks names up through the proxy." },
      },
    });

    await user.type(await screen.findByLabelText("Proxy URL"), "socks5://127.0.0.1:1080");
    await user.click(screen.getByRole("button", { name: "Save proxy" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Use socks5h, which looks names up through the proxy.",
    );
    expect(screen.getByLabelText("Proxy URL")).toHaveValue("socks5://127.0.0.1:1080");
  });

  it("removes the proxy and says it is gone", async () => {
    let answer: ProxySetting | null = WITH_LOGIN;
    const user = userEvent.setup();
    const { calls } = open(WITH_LOGIN, {
      "GET /api/proxies/bilibili": () => ({ body: answer }),
      "DELETE /api/proxies/bilibili": () => {
        answer = null;
        return { status: 204 };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Remove proxy" }));

    expect(await screen.findByText("Removed.")).toBeInTheDocument();
    expect(calls).toContain("DELETE /api/proxies/bilibili");
    expect(
      screen.getByText("No proxy is set, so Bilibili is reached directly."),
    ).toBeInTheDocument();
  });

  it("shows why the proxy could not be read", async () => {
    serve({
      "GET /api/proxies/bilibili": { status: 503, body: { detail: "The Keychain didn't answer." } },
    });
    render(<BilibiliSettings />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The Keychain didn't answer.");
  });
});
