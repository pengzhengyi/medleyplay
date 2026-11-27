/**
 * @file The AI section of Settings, for an admin: the providers that suggest a Track's
 * details, in the order they are asked, and the suggestions for every Track.
 *
 * A provider is any service that speaks the OpenAI chat protocol: DeepSeek, OpenAI,
 * Anthropic, or a local Ollama. Each saved one is a card; the first is asked first, and
 * the next whenever one fails. A key is typed into a password field, kept in the
 * Keychain, and never shown again: a card shows only whether there is one.
 */

import {
  type Announcements,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  type UniqueIdentifier,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { PlusIcon } from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useEffectEvent, useMemo, useState } from "react";

import { isCopilot, movedOrder, providerNameOf } from "../aiProviders";
import { AI_ENRICHER, type AiPreset, type AiProvider, type AiSetting, api } from "../api";
import { useFormattingLocale, useWords } from "../locale";
import { classOf, useNote } from "../useNote";
import { AiProviderCard } from "./AiProviderCard";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];
const INSTRUCTIONS = {
  draggable:
    "To reorder, press Space to pick the provider up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
};
const OTHER: AiPreset = { name: "Other", base_url: "", model: "" };

const WORDS: EnricherWords = {
  enricher: AI_ENRICHER,
  site: "the AI provider",
  heading: "Suggestions",
  description:
    "AI can suggest titles, artists, albums, and years in Edit details. These suggestions change nothing until used. If Split albums is set to Auto, medleyplay also asks for missing song lists in the background and can apply trusted lists automatically. Automatic requests wait at least two seconds between tracks and do not repeat the same text within a day. Ask again sends another request.",
  manualHelp:
    "Track details are requested when someone chooses to ask. Auto splitting can still request missing song lists in the background.",
  count: (count, t) => t("ai_details_eligible", { count }),
  off: "Suggesting details with AI is turned off.",
};

/**
 * The providers in order, a way to add one, and the suggestions for every Track.
 * `onChanged` is called after a provider is added or removed, since that changes which
 * Tracks can be suggested for.
 */
export function AiSettings({ onChanged }: { readonly onChanged: () => void }) {
  const t = useWords();
  const locale = useFormattingLocale();
  const number = useMemo(() => new Intl.NumberFormat(locale), [locale]);
  const [setting, setSetting] = useState<AiSetting | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [adding, setAdding] = useState<AiPreset | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const notes = useNote();
  const [error, setError] = useState("");
  const sensors = useSensors(
    // A few pixels of movement first, so a tap on the handle isn't a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const read = (then = "") => {
    api.ai().then((answer) => {
      setSetting(answer);
      notes.tell(then);
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    read();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const providers = setting?.providers ?? [];
  const presets = setting?.presets ?? [];
  const nameOf = (provider: AiProvider | undefined) =>
    provider === undefined ? "The provider" : providerNameOf(provider, presets);
  const placeOf = (id: UniqueIdentifier | undefined) =>
    providers.findIndex((provider) => provider.id === id);
  const withProviders = (next: readonly AiProvider[]) => {
    setSetting((was) => (was === null ? was : { ...was, providers: next }));
  };

  const startAdding = (preset: AiPreset) => {
    setAdding(preset);
    setBaseUrl(preset.base_url);
    setModel(preset.model);
    setError("");
    notes.tell("");
  };
  const add = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const typed = key.trim();
    api
      .addAiProvider(baseUrl.trim(), model.trim(), typed === "" ? undefined : typed)
      .then((added) => {
        setKey("");
        setAdding(null);
        withProviders([...providers, added]);
        notes.confirm(`${nameOf(added)} added.`);
        onChanged();
      }, failed);
  };
  const move = (from: number, to: number) => {
    const moved = providers[from];
    if (moved === undefined || to < 0 || to >= providers.length || from === to) {
      return;
    }
    const order = movedOrder(
      providers.map((each) => each.id),
      from,
      to,
    );
    withProviders(order.flatMap((id) => providers.filter((each) => each.id === id)));
    setError("");
    api.reorderAi(order).then(
      (saved) => {
        withProviders(saved);
        notes.confirm(
          `${nameOf(moved)} moved to ${String(to + 1)} of ${String(providers.length)}.`,
        );
      },
      (failure: unknown) => {
        failed(failure);
        read();
      },
    );
  };
  const removed = (provider: AiProvider) => {
    setOpened(null);
    withProviders(providers.filter((each) => each.id !== provider.id));
    notes.confirm(`${nameOf(provider)} removed.`);
    onChanged();
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${nameOf(providers[placeOf(active.id)])}.`,
    onDragOver: ({ active, over }) =>
      over === null || over.id === active.id
        ? undefined
        : `${nameOf(providers[placeOf(active.id)])} would be asked ${String(placeOf(over.id) + 1)}.`,
    onDragEnd: ({ active, over }) =>
      `${nameOf(providers[placeOf(active.id)])} is asked ${String(placeOf(over?.id ?? active.id) + 1)}.`,
    onDragCancel: ({ active }) => `${nameOf(providers[placeOf(active.id)])} stays where it was.`,
  };
  const drop = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) {
      move(placeOf(active.id), placeOf(over.id));
    }
  };

  const full = setting !== null && providers.length >= setting.max_providers;
  const saved = (preset: AiPreset) =>
    providers.some((each) => each.base_url === preset.base_url && each.model === preset.model);
  return (
    <>
      <h4>Providers</h4>
      {error !== "" && <p role="alert">{error}</p>}
      {setting === null ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            Reading the providers…
          </p>
        )
      ) : (
        <>
          <p className="hint">
            {t(
              "A video's title, description, and chapters are sent to the providers you set here, with the file's name, the Track's length, and the details it shows. Only the first {{limit}} characters of the description are sent.",
              {
                limit: number.format(setting.max_description),
              },
            )}
          </p>
          {providers.length === 0 ? (
            <p>{t("No AI provider is set up.")}</p>
          ) : (
            <>
              {providers.length > 1 && (
                <p className="hint">Asked in this order; the next is asked when one fails.</p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={MODIFIERS}
                accessibility={{ announcements, screenReaderInstructions: INSTRUCTIONS }}
                onDragEnd={drop}
              >
                <SortableContext
                  items={providers.map((each) => each.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ol className="ai-providers" aria-label="AI providers">
                    {providers.map((provider, index) => (
                      <AiProviderCard
                        key={provider.id}
                        provider={provider}
                        name={nameOf(provider)}
                        place={index + 1}
                        count={providers.length}
                        open={opened === provider.id}
                        onToggle={() => {
                          setOpened(opened === provider.id ? null : provider.id);
                        }}
                        onMove={(by) => {
                          move(index, index + by);
                        }}
                        onChanged={(next) => {
                          withProviders(
                            providers.map((each) => (each.id === next.id ? next : each)),
                          );
                        }}
                        onRemoved={() => {
                          removed(provider);
                        }}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            </>
          )}
          {full ? (
            <p className="hint">
              At most {String(setting.max_providers)} providers are kept; remove one to add another.
            </p>
          ) : (
            <p className="ai-presets" role="group" aria-label="Add a provider">
              <PlusIcon className="ai-presets-icon" aria-hidden />
              {[...setting.presets, OTHER].map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  className={
                    adding?.name === preset.name
                      ? "secondary ai-preset on"
                      : "secondary outline ai-preset"
                  }
                  aria-pressed={adding?.name === preset.name}
                  aria-disabled={preset !== OTHER && saved(preset)}
                  title={
                    preset === OTHER
                      ? "Another provider that speaks the OpenAI chat protocol"
                      : saved(preset)
                        ? `${preset.name} is set up already; change its model in its card`
                        : `Add ${preset.name}, asking ${preset.model}`
                  }
                  onClick={() => {
                    if (preset === OTHER || !saved(preset)) {
                      startAdding(preset);
                    }
                  }}
                >
                  {preset.name}
                </button>
              ))}
            </p>
          )}
          {adding !== null && !full && (
            <form className="proxy-form" aria-label={`Add ${adding.name}`} onSubmit={add}>
              <label className="mark-name">
                Base URL
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={baseUrl}
                  maxLength={256}
                  placeholder="https://api.deepseek.com"
                  onChange={(event) => {
                    setBaseUrl(event.target.value);
                  }}
                />
              </label>
              <label className="mark-name">
                Model
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={model}
                  maxLength={128}
                  placeholder="deepseek-flash"
                  onChange={(event) => {
                    setModel(event.target.value);
                  }}
                />
              </label>
              <label className="mark-name">
                {isCopilot(baseUrl) ? "GitHub token" : "Key"}
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  maxLength={512}
                  onChange={(event) => {
                    setKey(event.target.value);
                  }}
                />
              </label>
              <button type="submit" disabled={baseUrl.trim() === "" || model.trim() === ""}>
                Add provider
              </button>
              <button
                type="button"
                className="secondary outline"
                onClick={() => {
                  setAdding(null);
                  setError("");
                }}
              >
                Cancel
              </button>
              {isCopilot(baseUrl) ? (
                <p className="hint">
                  A fine-grained GitHub token with the Copilot Requests permission, of an account
                  with Copilot (
                  <a
                    href="https://github.com/settings/personal-access-tokens/new"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    create one
                  </a>
                  ). Each question counts against your Copilot allowance. The token is kept in the
                  Keychain and never shown again.
                </p>
              ) : (
                <p className="hint">
                  The key is kept in the Keychain and never shown again. A local Ollama needs none.
                  Plain http is for an address on this machine only.
                </p>
              )}
            </form>
          )}
          <p className={classOf(notes.note)} role="status">
            {notes.note.text}
          </p>
        </>
      )}
      <EnricherSettings words={WORDS} onChanged={onChanged} />
    </>
  );
}
