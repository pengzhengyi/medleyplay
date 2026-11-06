import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AiProvider, AiSetting, Enricher } from "../api";
import { type Routes, enricherOf, serve } from "../testing/server";
import { AiSettings } from "./AiSettings";

const KEY = "sk-4f9a1c7e5b2d";

const PRESETS: AiSetting["presets"] = [
  { name: "DeepSeek", base_url: "https://api.deepseek.com", model: "deepseek-flash" },
  { name: "OpenAI", base_url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { name: "Anthropic", base_url: "https://api.anthropic.com/v1", model: "claude-haiku-5-5" },
  { name: "Ollama", base_url: "http://127.0.0.1:11434/v1", model: "llama3.2" },
];

/** DeepSeek with a key, saved at noon. */
const DEEPSEEK: AiProvider = {
  base_url: "https://api.deepseek.com",
  model: "deepseek-flash",
  has_key: true,
  saved_at: "2026-11-06T12:00:00Z",
};

/** The provider as the server shows it: `provider`, or none, and the presets. */
const settingOf = (provider: AiProvider | null): AiSetting => ({
  provider,
  presets: PRESETS,
  max_description: 6000,
});

/** The AI enricher on, not stopped, and able to be asked about the Tracks `eligible`. */
const running = (eligible: readonly number[]): Enricher => enricherOf("ai-details", eligible);

function open(provider: AiProvider | null, routes: Routes = {}, enricher = running([1, 2])) {
  const onChanged = vi.fn();
  const served = serve({
    "GET /api/ai": { body: settingOf(provider) },
    "GET /api/enrichers/ai-details": { body: enricher },
    ...routes,
  });
  render(<AiSettings onChanged={onChanged} />);
  return { ...served, onChanged };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the AI provider", () => {
  it("says that a video's title, description, and chapters are sent to the provider", async () => {
    open(null);

    expect(
      await screen.findByText(/title, description, and chapters are sent to the provider/u),
    ).toBeInTheDocument();
  });

  it("says how much of the description is sent", async () => {
    open(null);

    expect(
      await screen.findByText(/first 6,000 characters of the description/u),
    ).toBeInTheDocument();
  });

  it("says no provider is set up before one is", async () => {
    open(null);

    expect(await screen.findByText("No AI provider is set up.")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByLabelText("Model")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Save provider" })).toBeDisabled();
  });

  it("fills the base URL and a model from each preset", async () => {
    const user = userEvent.setup();
    open(null);
    await screen.findByLabelText("Base URL");

    for (const preset of PRESETS) {
      await user.click(screen.getByRole("button", { name: preset.name }));

      expect(screen.getByLabelText("Base URL")).toHaveValue(preset.base_url);
      expect(screen.getByLabelText("Model")).toHaveValue(preset.model);
    }
  });

  it("keeps the key typed when a preset is chosen", async () => {
    const user = userEvent.setup();
    open(null);

    await user.type(await screen.findByLabelText("Key"), KEY);
    await user.click(screen.getByRole("button", { name: "DeepSeek" }));

    expect(screen.getByLabelText("Key")).toHaveValue(KEY);
  });

  it("saves the base URL, the model, and the key, then never shows the key again", async () => {
    let sent: unknown;
    let provider: AiProvider | null = null;
    const user = userEvent.setup();
    const { onChanged } = open(null, {
      "GET /api/ai": () => ({ body: settingOf(provider) }),
      "PUT /api/ai": (body) => {
        sent = body;
        provider = DEEPSEEK;
        return { body: DEEPSEEK };
      },
    });
    await screen.findByLabelText("Base URL");

    await user.click(screen.getByRole("button", { name: "DeepSeek" }));
    await user.type(screen.getByLabelText("Key"), `  ${KEY}  `);
    await user.click(screen.getByRole("button", { name: "Save provider" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(sent).toEqual({
      base_url: "https://api.deepseek.com",
      model: "deepseek-flash",
      key: KEY,
    });
    expect(screen.getByLabelText("New key")).toHaveValue("");
    expect(screen.getByText("A key is set.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(KEY);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("types the key into a password field that the browser does not fill in", async () => {
    open(null);

    const field = await screen.findByLabelText("Key");

    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
  });

  it("shows the address and model of a provider that is set up, and that it has a key", async () => {
    open(DEEPSEEK);

    expect(await screen.findByText("A key is set.")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("Model")).toHaveValue("deepseek-flash");
    expect(screen.getByLabelText("New key")).toHaveValue("");
    expect(document.body).not.toHaveTextContent(KEY);
  });

  it("saves another model without sending a key, so the key it has stays", async () => {
    let sent: unknown;
    const user = userEvent.setup();
    open(DEEPSEEK, {
      "PUT /api/ai": (body) => {
        sent = body;
        return { body: DEEPSEEK };
      },
    });
    const model = await screen.findByLabelText("Model");

    await user.clear(model);
    await user.type(model, "deepseek-reasoner");
    await user.click(screen.getByRole("button", { name: "Save provider" }));

    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(sent).toEqual({ base_url: "https://api.deepseek.com", model: "deepseek-reasoner" });
  });

  it("says a provider without a key has none, and that a local one needs none", async () => {
    open({ ...DEEPSEEK, has_key: false });

    expect(await screen.findByText("No key is set.")).toBeInTheDocument();
    expect(screen.getByText(/A local Ollama needs none/u)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove key" })).toBeNull();
  });

  it("removes the key and says there is none, keeping the address and model", async () => {
    let provider: AiProvider = DEEPSEEK;
    const user = userEvent.setup();
    const { calls, onChanged } = open(DEEPSEEK, {
      "GET /api/ai": () => ({ body: settingOf(provider) }),
      "DELETE /api/ai/key": () => {
        provider = { ...DEEPSEEK, has_key: false };
        return { body: provider };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Remove key" }));

    expect(await screen.findByText("Key removed.")).toBeInTheDocument();
    expect(calls).toContain("DELETE /api/ai/key");
    expect(screen.getByText("No key is set.")).toBeInTheDocument();
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    const user = userEvent.setup();
    const { onChanged } = open(null, {
      "PUT /api/ai": {
        status: 422,
        body: { detail: "The base URL is https unless it is on this machine." },
      },
    });

    await user.type(await screen.findByLabelText("Base URL"), "http://api.deepseek.com");
    await user.type(screen.getByLabelText("Model"), "deepseek-flash");
    await user.type(screen.getByLabelText("Key"), KEY);
    await user.click(screen.getByRole("button", { name: "Save provider" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The base URL is https unless it is on this machine.",
    );
    expect(screen.getByLabelText("Base URL")).toHaveValue("http://api.deepseek.com");
    expect(screen.getByLabelText("Key")).toHaveValue(KEY);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("shows why the provider could not be read", async () => {
    serve({ "GET /api/ai": { status: 403, body: { detail: "Only an admin can set it up." } } });
    render(<AiSettings onChanged={vi.fn()} />);

    expect(await screen.findByText("Only an admin can set it up.")).toBeInTheDocument();
  });
});

describe("the AI suggestions", () => {
  it("says how many Tracks can be given suggestions", async () => {
    open(DEEPSEEK, {}, running([1, 2, 3]));

    expect(await screen.findByText("3 Tracks can be given suggestions.")).toBeInTheDocument();
  });

  it("says suggestions only suggest, and are asked for once a day per text", async () => {
    open(DEEPSEEK);

    expect(await screen.findByText(/only a suggestion/u)).toBeInTheDocument();
    expect(screen.getByText(/never about the same text twice in a day/u)).toBeInTheDocument();
  });

  it("shows it stopped after the provider refused the key, with a reset", async () => {
    const stopped: Enricher = {
      ...running([]),
      stopped: {
        at: "2026-11-06T12:00:00Z",
        reason: "The AI provider refused the key or the account (401). Check the key.",
      },
    };
    open(DEEPSEEK, {}, stopped);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stopped after the AI provider refused a request: The AI provider refused the key or the account (401). Check the key. Nothing more is asked until it is reset.",
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("says suggestions are turned off when the plugin is", async () => {
    open(DEEPSEEK, {}, { ...running([]), available: false });

    expect(
      await screen.findByText("Suggesting details with AI is turned off."),
    ).toBeInTheDocument();
  });
});
