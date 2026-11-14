import { cleanup, render, screen, within } from "@testing-library/react";
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

/** DeepSeek's `deepseek-flash` with a key, saved at noon, that has not failed. */
const DEEPSEEK: AiProvider = {
  id: "d1",
  base_url: "https://api.deepseek.com",
  model: "deepseek-flash",
  has_key: true,
  saved_at: "2026-11-06T12:00:00Z",
  failure: null,
  failed_at: null,
  failure_reason: null,
  failure_status: null,
};

/** A local Ollama, which needs no key. */
const OLLAMA: AiProvider = {
  ...DEEPSEEK,
  id: "o1",
  base_url: "http://127.0.0.1:11434/v1",
  model: "llama3.2",
  has_key: false,
};

/** The providers as the server shows them, in order, with the presets and the limits. */
const settingOf = (providers: readonly AiProvider[]): AiSetting => ({
  providers,
  presets: PRESETS,
  max_providers: 5,
  max_description: 6000,
});

/** The AI enricher on, not stopped, and able to be asked about the Tracks `eligible`. */
const running = (eligible: readonly number[]): Enricher => enricherOf("ai-details", eligible);

function open(providers: readonly AiProvider[], routes: Routes = {}, enricher = running([1, 2])) {
  const onChanged = vi.fn();
  const served = serve({
    "GET /api/ai": { body: settingOf(providers) },
    "GET /api/enrichers/ai-details": { body: enricher },
    ...routes,
  });
  render(<AiSettings onChanged={onChanged} />);
  return { ...served, onChanged };
}

/** The saved providers' cards, in order. */
const cards = async () =>
  within(await screen.findByRole("list", { name: "AI providers" })).getAllByRole("listitem");

/** The card at `place` in the order, from 1. */
async function cardAt(place: number): Promise<HTMLElement> {
  const card = (await cards())[place - 1];
  if (card === undefined) {
    throw new Error(`There is no card ${String(place)}.`);
  }
  return card;
}

/** The header of the card of the provider named `name`, which opens and closes it. */
const header = (name: string) =>
  screen.findByRole("button", { name: new RegExp(`^${name}, `, "u") });

/** Open the card of the provider named `name`. */
async function openCard(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await header(name));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("what is sent to a provider", () => {
  it("says a video's title, description, and chapters are sent, and how much of it", async () => {
    open([]);

    expect(
      await screen.findByText(/title, description, and chapters are sent to the providers/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/first 6,000 characters of the description/u)).toBeInTheDocument();
  });
});

describe("adding a provider", () => {
  it("says none is set up, and offers each preset and another provider to add", async () => {
    open([]);

    expect(await screen.findByText("No AI provider is set up.")).toBeInTheDocument();
    const offered = within(screen.getByRole("group", { name: "Add a provider" }));
    expect(offered.getAllByRole("button").map((each) => each.textContent)).toEqual([
      "DeepSeek",
      "OpenAI",
      "Anthropic",
      "Ollama",
      "Other",
    ]);
    expect(screen.queryByLabelText("Base URL")).toBeNull();
  });

  it("fills the base URL and a model from the preset chosen", async () => {
    const user = userEvent.setup();
    open([]);

    await user.click(await screen.findByRole("button", { name: "OpenAI" }));

    const form = screen.getByRole("form", { name: "Add OpenAI" });
    expect(within(form).getByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1");
    expect(within(form).getByLabelText("Model")).toHaveValue("gpt-4o-mini");
  });

  it("starts another provider empty, and adds it only once it has an address and a model", async () => {
    const user = userEvent.setup();
    open([]);

    await user.click(await screen.findByRole("button", { name: "Other" }));

    expect(screen.getByLabelText("Base URL")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add provider" })).toBeDisabled();
  });

  it("types the key into a password field that the browser does not fill in", async () => {
    const user = userEvent.setup();
    open([]);

    await user.click(await screen.findByRole("button", { name: "DeepSeek" }));

    const field = screen.getByLabelText("Key");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "off");
  });

  it("adds the provider as a card after the others, and never shows the key again", async () => {
    let sent: unknown;
    const user = userEvent.setup();
    const { onChanged } = open([], {
      "POST /api/ai/providers": (body) => {
        sent = body;
        return { status: 201, body: DEEPSEEK };
      },
    });

    await user.click(await screen.findByRole("button", { name: "DeepSeek" }));
    await user.type(screen.getByLabelText("Key"), `  ${KEY}  `);
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    expect(await screen.findByText("DeepSeek added.")).toBeInTheDocument();
    expect(sent).toEqual({
      base_url: "https://api.deepseek.com",
      model: "deepseek-flash",
      key: KEY,
    });
    expect(await cards()).toHaveLength(1);
    expect(screen.queryByRole("form")).toBeNull();
    expect(document.body).not.toHaveTextContent(KEY);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("adds a local provider without a key", async () => {
    let sent: unknown;
    const user = userEvent.setup();
    open([], {
      "POST /api/ai/providers": (body) => {
        sent = body;
        return { status: 201, body: OLLAMA };
      },
    });

    await user.click(await screen.findByRole("button", { name: "Ollama" }));
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    expect(await screen.findByText("Ollama added.")).toBeInTheDocument();
    expect(sent).toEqual({ base_url: "http://127.0.0.1:11434/v1", model: "llama3.2" });
  });

  it("shows the server's refusal and keeps what was typed", async () => {
    const user = userEvent.setup();
    const { onChanged } = open([], {
      "POST /api/ai/providers": {
        status: 422,
        body: { detail: "The base URL is https unless it is on this machine." },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Other" }));
    await user.type(screen.getByLabelText("Base URL"), "http://api.deepseek.com");
    await user.type(screen.getByLabelText("Model"), "deepseek-flash");
    await user.type(screen.getByLabelText("Key"), KEY);
    await user.click(screen.getByRole("button", { name: "Add provider" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The base URL is https unless it is on this machine.",
    );
    expect(screen.getByLabelText("Base URL")).toHaveValue("http://api.deepseek.com");
    expect(screen.getByLabelText("Key")).toHaveValue(KEY);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offers no preset already set up", async () => {
    open([DEEPSEEK]);

    expect(await screen.findByRole("button", { name: "DeepSeek" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute(
      "title",
      "Set up already",
    );
    expect(screen.getByRole("button", { name: "OpenAI" })).toBeEnabled();
  });

  it("offers nothing more to add once the most providers are kept", async () => {
    serve({
      "GET /api/ai": { body: { ...settingOf([DEEPSEEK, OLLAMA]), max_providers: 2 } },
      "GET /api/enrichers/ai-details": { body: running([]) },
    });
    render(<AiSettings onChanged={vi.fn()} />);

    expect(await screen.findByText(/At most 2 providers are kept/u)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Add a provider" })).toBeNull();
  });
});

describe("a saved provider", () => {
  it("is a card showing its place, name, model, and that it has a key", async () => {
    open([DEEPSEEK]);

    const card = await cardAt(1);

    expect(within(card).getByText("1")).toHaveClass("ai-provider-place");
    expect(within(card).getByText("deepseek-flash")).toHaveClass("ai-provider-model");
    expect(await header("DeepSeek")).toHaveAccessibleName("DeepSeek, deepseek-flash, has a key");
    expect(document.body).not.toHaveTextContent(KEY);
  });

  it("shows a local provider is on this Mac, needing no key", async () => {
    open([OLLAMA]);

    expect(await header("Ollama")).toHaveAccessibleName("Ollama, llama3.2, on this Mac");
  });

  it("is named by its host when no preset has its address", async () => {
    open([{ ...DEEPSEEK, base_url: "https://llm.example.com/v1" }]);

    const [card] = await cards();

    expect(card).toHaveTextContent("llm.example.com");
  });

  it("opens to its address, model, and key as read-only fields", async () => {
    const user = userEvent.setup();
    open([DEEPSEEK]);

    await openCard(user, "DeepSeek");

    expect(await header("DeepSeek")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Base URL")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("Model")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Key")).toHaveValue("Kept in the Keychain");
  });

  it("shows why it last failed and when, and how to fix it", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-11-06T14:00:00Z"));
    open([{ ...DEEPSEEK, failure: "refused", failed_at: "2026-11-06T12:00:00Z" }]);

    expect(await header("DeepSeek")).toHaveAccessibleName(
      "DeepSeek, deepseek-flash, has a key, Key refused 2 hr. ago",
    );
    expect(screen.getByTitle("Replace the key.")).toHaveTextContent("Key refused 2 hr. ago");
  });

  it("says what was wrong with an answer it couldn't use", async () => {
    const user = userEvent.setup();
    open([
      {
        ...DEEPSEEK,
        failure: "unusable",
        failed_at: DEEPSEEK.saved_at,
        failure_reason: "cut_off",
      },
    ]);

    await openCard(user, "DeepSeek");

    expect(screen.getByText(/^Answer unusable/, { selector: "p" })).toHaveTextContent(
      "Its answer ran out of room before it finished.",
    );
  });

  it("changes its model in place, keeping its key", async () => {
    let sent: unknown;
    const user = userEvent.setup();
    open([DEEPSEEK], {
      "PUT /api/ai/providers/d1/model": (body) => {
        sent = body;
        return { body: { ...DEEPSEEK, model: "deepseek-pro" } };
      },
    });
    await openCard(user, "DeepSeek");

    await user.click(screen.getByRole("button", { name: "Change model" }));
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "deepseek-pro");
    await user.click(screen.getByRole("button", { name: "Save model" }));

    expect(await screen.findByText("Model saved.")).toBeInTheDocument();
    expect(sent).toEqual({ model: "deepseek-pro" });
    expect(screen.getByLabelText("Model")).toHaveValue("deepseek-pro");
    expect(screen.getByLabelText("Model")).toHaveAttribute("readonly");
  });

  it("replaces its key, and never shows the key", async () => {
    let sent: unknown;
    const user = userEvent.setup();
    open([{ ...DEEPSEEK, failure: "refused", failed_at: DEEPSEEK.saved_at }], {
      "PUT /api/ai/providers/d1/key": (body) => {
        sent = body;
        return { body: DEEPSEEK };
      },
    });
    await openCard(user, "DeepSeek");

    await user.click(screen.getByRole("button", { name: "Replace key" }));
    await user.type(screen.getByLabelText("New key"), KEY);
    await user.click(screen.getByRole("button", { name: "Save key" }));

    expect(await screen.findByText("Key saved.")).toBeInTheDocument();
    expect(sent).toEqual({ key: KEY });
    expect(document.body).not.toHaveTextContent(KEY);
    expect(document.body).not.toHaveTextContent("Key refused");
  });

  it("asks before removing it, saying its key is deleted from this Mac", async () => {
    const user = userEvent.setup();
    const { calls, onChanged } = open([DEEPSEEK, OLLAMA], {
      "DELETE /api/ai/providers/d1": { status: 204 },
    });
    await openCard(user, "DeepSeek");

    await user.click(screen.getByRole("button", { name: "Remove" }));

    const confirm = screen.getByRole("group", { name: "Remove" });
    expect(confirm).toHaveTextContent("Remove DeepSeek and delete its key from this Mac?");
    expect(calls).not.toContain("DELETE /api/ai/providers/d1");

    await user.click(within(confirm).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText("DeepSeek removed.")).toBeInTheDocument();
    expect(await cards()).toHaveLength(1);
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("says removing the last provider stops the suggestions", async () => {
    const user = userEvent.setup();
    open([OLLAMA]);
    await openCard(user, "Ollama");

    await user.click(screen.getByRole("button", { name: "Remove" }));

    expect(screen.getByRole("group", { name: "Remove" })).toHaveTextContent(
      "Remove Ollama? Suggestions stop until another provider is added.",
    );
  });
});

describe("the order providers are asked in", () => {
  it("is said only once there are several, with no way to reorder one alone", async () => {
    open([DEEPSEEK]);

    await cards();

    expect(screen.queryByText(/Asked in this order/u)).toBeNull();
    expect(screen.queryByRole("button", { name: "Move DeepSeek down" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reorder DeepSeek" })).toBeNull();
  });

  it("moves a provider down, saves every provider's place, and says where it is", async () => {
    let sent: unknown;
    const user = userEvent.setup();
    open([DEEPSEEK, OLLAMA], {
      "PUT /api/ai/order": (body) => {
        sent = body;
        return { body: [OLLAMA, DEEPSEEK] };
      },
    });
    expect(await screen.findByText(/Asked in this order/u)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move DeepSeek up" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Move DeepSeek down" }));

    expect(await screen.findByText("DeepSeek moved to 2 of 2.")).toBeInTheDocument();
    expect(sent).toEqual({ ids: ["o1", "d1"] });
    const [first, second] = await cards();
    expect(first).toHaveTextContent("1Ollama");
    expect(second).toHaveTextContent("2DeepSeek");
  });

  it("shows the order as it is when it changed since it was read", async () => {
    let reads = 0;
    const user = userEvent.setup();
    open([DEEPSEEK, OLLAMA], {
      "GET /api/ai": () => {
        reads += 1;
        return { body: settingOf(reads === 1 ? [DEEPSEEK, OLLAMA] : [OLLAMA]) };
      },
      "PUT /api/ai/order": {
        status: 409,
        body: { detail: "The AI providers changed since they were shown; here they are now." },
      },
    });

    await user.click(await screen.findByRole("button", { name: "Move DeepSeek down" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("changed since they were shown");
    await vi.waitFor(async () => {
      expect(await cards()).toHaveLength(1);
    });
  });
});

describe("reading the providers", () => {
  it("shows why the providers could not be read", async () => {
    serve({ "GET /api/ai": { status: 403, body: { detail: "Only an admin can set it up." } } });
    render(<AiSettings onChanged={vi.fn()} />);

    expect(await screen.findByText("Only an admin can set it up.")).toBeInTheDocument();
  });
});

describe("the AI suggestions", () => {
  it("says how many Tracks can be given suggestions", async () => {
    open([DEEPSEEK], {}, running([1, 2, 3]));

    expect(await screen.findByText("3 Tracks can be given suggestions.")).toBeInTheDocument();
  });

  it("says suggestions only suggest, and are asked for once a day per text", async () => {
    open([DEEPSEEK]);

    expect(await screen.findByText(/only a suggestion/u)).toBeInTheDocument();
    expect(screen.getByText(/never about the same text twice in a day/u)).toBeInTheDocument();
  });

  it("shows it stopped after the providers refused the key, with a reset", async () => {
    const stopped: Enricher = {
      ...running([]),
      stopped: {
        at: "2026-11-06T12:00:00Z",
        reason: "The AI provider refused the key or the account (401). Check the key.",
      },
    };
    open([DEEPSEEK], {}, stopped);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Stopped after the AI provider refused a request: The AI provider refused the key or the account (401). Check the key. Nothing more is asked until it is reset.",
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("says suggestions are turned off when the plugin is", async () => {
    open([DEEPSEEK], {}, { ...running([]), available: false });

    expect(
      await screen.findByText("Suggesting details with AI is turned off."),
    ).toBeInTheDocument();
  });
});
