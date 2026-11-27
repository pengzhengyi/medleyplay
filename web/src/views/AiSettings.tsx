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
import { Trans } from "react-i18next";

import { isCopilot, movedOrder, providerError, providerNameOf } from "../aiProviders";
import { AI_ENRICHER, type AiPreset, type AiProvider, type AiSetting, api } from "../api";
import { useFormattingLocale, useWords } from "../locale";
import { classOf, useNoteOf } from "../useNote";
import { AiProviderCard } from "./AiProviderCard";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];
const OTHER: AiPreset = { name: "Other", base_url: "", model: "" };
const COPILOT_HELP =
  "A fine-grained GitHub token with the Copilot Requests permission, of an account with Copilot (<create>create one</create>). Each question counts against your Copilot allowance. The token is kept in the Keychain and never shown again.";
type ProviderNotice =
  | { readonly key: "{{name}} added." | "{{name}} removed."; readonly name: string }
  | {
      readonly key: "{{name}} moved to {{position}} of {{total}}.";
      readonly name: string;
      readonly position: number;
      readonly total: number;
    };

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
  const [submitting, setSubmitting] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const notes = useNoteOf<ProviderNotice | null>(null);
  const [failureToReport, setFailureToReport] = useState<{ cause: unknown; adding: boolean }>();
  const error =
    failureToReport === undefined
      ? ""
      : providerError(
          failureToReport.cause,
          failureToReport.adding ? "Could not add the provider. Try again." : undefined,
          t,
        );
  const sensors = useSensors(
    // A few pixels of movement first, so a tap on the handle isn't a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const failed = (cause: unknown) => {
    setFailureToReport({ cause, adding: false });
  };
  const read = () => {
    api.ai().then((answer) => {
      setSetting(answer);
      notes.tell(null);
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
    provider === undefined ? t("The provider") : providerNameOf(provider, presets);
  const placeOf = (id: UniqueIdentifier | undefined) =>
    providers.findIndex((provider) => provider.id === id);
  const withProviders = (next: readonly AiProvider[]) => {
    setSetting((was) => (was === null ? was : { ...was, providers: next }));
  };

  const startAdding = (preset: AiPreset) => {
    setAdding(preset);
    setBaseUrl(preset.base_url);
    setModel(preset.model);
    setKey("");
    setFailureToReport(undefined);
    notes.tell(null);
  };
  const add = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setFailureToReport(undefined);
    const typed = key.trim();
    api.addAiProvider(baseUrl.trim(), model.trim(), typed === "" ? undefined : typed).then(
      (added) => {
        setSubmitting(false);
        setKey("");
        setAdding(null);
        setSetting((was) =>
          was === null ? was : { ...was, providers: [...was.providers, added] },
        );
        notes.confirm({ key: "{{name}} added.", name: nameOf(added) });
        onChanged();
      },
      (cause: unknown) => {
        setSubmitting(false);
        setFailureToReport({ cause, adding: true });
      },
    );
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
    setFailureToReport(undefined);
    api.reorderAi(order).then(
      (saved) => {
        withProviders(saved);
        notes.confirm({
          key: "{{name}} moved to {{position}} of {{total}}.",
          name: nameOf(moved),
          position: to + 1,
          total: providers.length,
        });
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
    notes.confirm({ key: "{{name}} removed.", name: nameOf(provider) });
    onChanged();
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("Picked up {{name}}.", { name: nameOf(providers[placeOf(active.id)]) }),
    onDragOver: ({ active, over }) =>
      over === null || over.id === active.id
        ? undefined
        : t("{{name}} would be asked {{position}}.", {
            name: nameOf(providers[placeOf(active.id)]),
            position: number.format(placeOf(over.id) + 1),
          }),
    onDragEnd: ({ active, over }) =>
      t("{{name}} is asked {{position}}.", {
        name: nameOf(providers[placeOf(active.id)]),
        position: number.format(placeOf(over?.id ?? active.id) + 1),
      }),
    onDragCancel: ({ active }) =>
      t("{{name}} stays where it was.", { name: nameOf(providers[placeOf(active.id)]) }),
  };
  const drop = ({ active, over }: DragEndEvent) => {
    if (over !== null && active.id !== over.id) {
      move(placeOf(active.id), placeOf(over.id));
    }
  };

  const full = setting !== null && providers.length >= setting.max_providers;
  const enabledCount = providers.filter((provider) => provider.enabled).length;
  const saved = (preset: AiPreset) =>
    providers.some((each) => each.base_url === preset.base_url && each.model === preset.model);
  const presetName = (preset: AiPreset) => (preset === OTHER ? t("Other") : preset.name);
  const notice = notes.note.text;
  return (
    <>
      <h4>{t("Providers")}</h4>
      {error !== "" && <p role="alert">{error}</p>}
      {setting === null ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            {t("Reading the providers…")}
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
                <p className="hint">
                  {t("Asked in this order; the next is asked when one fails.")}
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={MODIFIERS}
                accessibility={{
                  announcements,
                  screenReaderInstructions: {
                    draggable: t(
                      "To reorder, press Space to pick the provider up, the arrow keys to move it, and Space again to drop it. Escape puts it back.",
                    ),
                  },
                }}
                onDragEnd={drop}
              >
                <SortableContext
                  items={providers.map((each) => each.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ol className="ai-providers" aria-label={t("AI providers")}>
                    {providers.map((provider, index) => (
                      <AiProviderCard
                        key={provider.id}
                        provider={provider}
                        name={nameOf(provider)}
                        place={index + 1}
                        count={providers.length}
                        enabledAfterRemoval={enabledCount > Number(provider.enabled)}
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
              {t("At most {{limit}} providers are kept; remove one to add another.", {
                limit: number.format(setting.max_providers),
              })}
            </p>
          ) : (
            <p className="ai-presets" role="group" aria-label={t("Add a provider")}>
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
                  disabled={submitting}
                  title={
                    preset === OTHER
                      ? t("Another provider that speaks the OpenAI chat protocol")
                      : saved(preset)
                        ? t("{{name}} is set up already; change its model in its card", {
                            name: preset.name,
                          })
                        : t("Add {{name}}, asking {{model}}", {
                            name: preset.name,
                            model: preset.model,
                          })
                  }
                  onClick={() => {
                    if (preset === OTHER || !saved(preset)) {
                      startAdding(preset);
                    }
                  }}
                >
                  {presetName(preset)}
                </button>
              ))}
            </p>
          )}
          {adding !== null && !full && (
            <form
              className="proxy-form"
              aria-label={t("Add {{name}}", { name: presetName(adding) })}
              aria-busy={submitting}
              onSubmit={add}
            >
              <label className="mark-name">
                {t("Base URL")}
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck={false}
                  value={baseUrl}
                  maxLength={256}
                  placeholder="https://api.deepseek.com"
                  readOnly={submitting}
                  onChange={(event) => {
                    const next = event.target.value;
                    if (baseUrl.trim() !== next.trim()) setKey("");
                    setBaseUrl(next);
                  }}
                />
              </label>
              <label className="mark-name">
                {t("Model")}
                <input
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={model}
                  maxLength={128}
                  placeholder="deepseek-flash"
                  readOnly={submitting}
                  onChange={(event) => {
                    setModel(event.target.value);
                  }}
                />
              </label>
              <label className="mark-name">
                {t(isCopilot(baseUrl) ? "GitHub token" : "Key")}
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  maxLength={512}
                  readOnly={submitting}
                  onChange={(event) => {
                    setKey(event.target.value);
                  }}
                />
              </label>
              <button
                type="submit"
                disabled={submitting || baseUrl.trim() === "" || model.trim() === ""}
              >
                {t("Add provider")}
              </button>
              <button
                type="button"
                className="secondary outline"
                disabled={submitting}
                onClick={() => {
                  setAdding(null);
                  setKey("");
                  setFailureToReport(undefined);
                }}
              >
                {t("Cancel")}
              </button>
              {isCopilot(baseUrl) ? (
                <p className="hint">
                  <Trans
                    t={t}
                    i18nKey={COPILOT_HELP}
                    defaults={COPILOT_HELP}
                    components={{
                      create: (
                        <a
                          href="https://github.com/settings/personal-access-tokens/new"
                          target="_blank"
                          rel="noopener noreferrer"
                        />
                      ),
                    }}
                  />
                </p>
              ) : (
                <p className="hint">
                  {t(
                    "The key is kept in the Keychain and never shown again. A local Ollama needs none. Plain http is for an address on this machine only.",
                  )}
                </p>
              )}
            </form>
          )}
          <p className={classOf(notes.note)} role="status">
            {notice === null
              ? ""
              : "position" in notice
                ? t(notice.key, {
                    name: notice.name,
                    position: number.format(notice.position),
                    total: number.format(notice.total),
                  })
                : t(notice.key, { name: notice.name })}
          </p>
        </>
      )}
      <EnricherSettings words={WORDS} onChanged={onChanged} />
    </>
  );
}
