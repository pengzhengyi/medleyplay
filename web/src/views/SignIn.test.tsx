import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ALICE, serve } from "../testing/server";
import { SignIn } from "./SignIn";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SignIn", () => {
  it("changes the sign-in language on this device without losing a typed username", async () => {
    serve({ "GET /api/setup": { body: { set_up: true } } });
    render(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "alice");

    await user.selectOptions(screen.getByRole("combobox", { name: "Language" }), "zh-Hans");

    expect(document.documentElement.lang).toBe("zh-Hans");
    expect(screen.getByLabelText("用户名")).toHaveValue("alice");
    expect(screen.getByRole("button", { name: "登录" })).toBeVisible();
    await user.selectOptions(screen.getByRole("combobox", { name: "语言" }), "auto");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  it("creates the admin on a server with no Accounts yet", async () => {
    const created: unknown[] = [];
    serve({
      "GET /api/setup": { body: { set_up: false, multiple_accounts: false } },
      "POST /api/setup": (body) => {
        created.push(body);
        return { status: 201, body: ALICE };
      },
    });
    const onSignedIn = vi.fn();
    render(<SignIn onSignedIn={onSignedIn} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Display name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "secret words");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    await vi.waitFor(() => {
      expect(onSignedIn).toHaveBeenCalledWith(ALICE);
    });
    expect(created).toEqual([
      { username: "alice", display_name: "Alice", password: "secret words" },
    ]);
  });

  it("says why a sign-in was refused", async () => {
    serve({
      "GET /api/setup": { body: { set_up: true, multiple_accounts: false } },
      "POST /api/session": { status: 401, body: { detail: "The username or password is wrong." } },
    });
    render(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The username or password is wrong.",
    );
  });

  it("explains the first account's requirements and a password refusal in Chinese", async () => {
    serve({
      "GET /api/setup": { body: { set_up: false } },
      "POST /api/setup": { status: 422, body: { detail: "A password must be 8-256 characters." } },
    });
    render(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    const username = await screen.findByLabelText("Username");
    const language = screen.getByRole("combobox", { name: "Language" });
    await user.type(username, "alice");
    await user.type(screen.getByLabelText("Display name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "example");
    await user.click(screen.getByRole("button", { name: "Create Account" }));

    try {
      await user.selectOptions(language, "zh-Hans");

      expect(username).toHaveAccessibleDescription(/1 至 32 个字符/u);
      expect(username).toHaveValue("alice");
      expect(await screen.findByRole("alert")).toHaveTextContent("密码必须包含 8 至 256 个字符。");
    } finally {
      await user.selectOptions(language, "auto");
    }
  });

  it("says when the server can't be reached", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("Failed to fetch")));

    render(<SignIn onSignedIn={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("The server can't be reached.");
  });

  it("checks setup again before choosing a form after a failed read", async () => {
    let failed = false;
    serve({
      "GET /api/setup": () => {
        if (failed) return { body: { set_up: false } };
        failed = true;
        return { status: 503 };
      },
    });
    render(<SignIn onSignedIn={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("The server can't be reached.");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Retry setup check" }));

    expect(await screen.findByRole("form", { name: "Create the admin Account" })).toBeVisible();
  });

  it("explains how to get an account when someone else has already set up the server", async () => {
    serve({
      "GET /api/setup": { body: { set_up: false } },
      "POST /api/setup": {
        status: 409,
        body: { detail: "medleyplay is already set up; an admin creates new Accounts." },
      },
    });
    render(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Display name"), "Alice");
    await user.type(screen.getByLabelText("Password"), "sample-password");

    await user.click(screen.getByRole("button", { name: "Create Account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No account was created.");
    expect(alert).toHaveTextContent("Otherwise, ask the admin to create one.");
  });

  it("does not repeat unexpected server diagnostics on the credential form", async () => {
    serve({
      "GET /api/setup": { body: { set_up: true } },
      "POST /api/session": {
        status: 500,
        body: { detail: "Unexpected failure for sample-secret." },
      },
    });
    render(<SignIn onSignedIn={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Username"), "alice");
    await user.type(screen.getByLabelText("Password"), "sample-secret");

    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not sign in. Try again.");
    expect(alert).not.toHaveTextContent("sample-secret");
  });
});
