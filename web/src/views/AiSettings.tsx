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
import { type SubmitEvent, useEffect, useEffectEvent, useState } from "react";

import { movedOrder, providerNameOf } from "../aiProviders";
import { AI_ENRICHER, type AiPreset, type AiProvider, type AiSetting, api } from "../api";
import { classOf, useNote } from "../useNote";
import { AiProviderCard } from "./AiProviderCard";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const number = new Intl.NumberFormat("en-US");
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
  description: (
    <>
      Suggest details with AI asks the providers for a song&apos;s title, artist, album, year, and
      song list. What it says is only a suggestion: it shows beside each detail in Edit details and
      changes nothing until someone uses it. It asks about one Track at a time, at most once every
      two seconds, and never about the same text twice in a day.
    </>
  ),
  count: (tracks) =>
    tracks === 1
      ? "1 Track can be given suggestions."
      : `${String(tracks)} Tracks can be given suggestions.`,
  off: "Suggesting details with AI is turned off.",
};

/**
 * The providers in order, a way to add one, and the suggestions for every Track.
 * `onChanged` is called after a provider is added or removed, since that changes which
 * Tracks can be suggested for.
 */
export function AiSettings({ onChanged }: { readonly onChanged: () => void }) {
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
            A video&apos;s title, description, and chapters are sent to the providers you set here,
            with the file&apos;s name, the Track&apos;s length, and the details it shows. Only the
            first {number.format(setting.max_description)} characters of the description are sent.
          </p>
          {providers.length === 0 ? (
            <p>No AI provider is set up.</p>
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
                  disabled={preset !== OTHER && saved(preset)}
                  title={
                    preset === OTHER
                      ? "Another provider that speaks the OpenAI chat protocol"
                      : saved(preset)
                        ? "Set up already"
                        : `Add ${preset.name}, asking ${preset.model}`
                  }
                  onClick={() => {
                    startAdding(preset);
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
                Key
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
              <p className="hint">
                The key is kept in the Keychain and never shown again. A local Ollama needs none.
                Plain http is for an address on this machine only.
              </p>
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
