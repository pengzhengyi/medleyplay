/**
 * @file One saved AI provider, as a card in the order providers are asked.
 *
 * Closed, the card is one line: the provider's place, name, model, and key, an icon
 * when it last failed that says why on hover, and a switch to turn it off. Opened, it
 * shows the address and model as read-only fields, and the few things that can change
 * while keeping its place: its model, its key, or removing it.
 */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  DotsSixVerticalIcon,
  HouseLineIcon,
  KeyIcon,
  WarningCircleIcon,
  WifiSlashIcon,
} from "@phosphor-icons/react";
import { type SubmitEvent, useId, useState } from "react";

import { FAILURE_WORDS, agoOf, fixOf, isLocal, providerError } from "../aiProviders";
import { type AiProvider, api } from "../api";
import { useFormattingLocale, useWords } from "../locale";
import { classOf, useNote } from "../useNote";
import { useNow } from "../useNow";

type Editing = "model" | "key" | "remove" | null;

export function AiProviderCard({
  provider,
  name,
  place,
  count,
  enabledAfterRemoval,
  open,
  onToggle,
  onMove,
  onChanged,
  onRemoved,
}: {
  readonly provider: AiProvider;
  /** The preset's name, or the provider's host. */
  readonly name: string;
  /** Its place in the order, from 1. */
  readonly place: number;
  /** How many providers there are. */
  readonly count: number;
  readonly enabledAfterRemoval: boolean;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onMove: (by: -1 | 1) => void;
  /** Called with the provider as saved after its model or key changed. */
  readonly onChanged: (saved: AiProvider) => void;
  readonly onRemoved: () => void;
}) {
  const bodyId = useId();
  const t = useWords();
  const locale = useFormattingLocale();
  const now = useNow();
  const [editing, setEditing] = useState<Editing>(null);
  const [model, setModel] = useState(provider.model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const notes = useNote();
  const [failureToReport, setFailureToReport] = useState<{
    cause: unknown;
    fallback: string | undefined;
  }>();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: provider.id });

  const local = isLocal(provider.base_url);
  const failure = provider.failure === null ? null : FAILURE_WORDS[provider.failure];
  const failedAgo = provider.failed_at === null ? "" : agoOf(provider.failed_at, now, locale);
  const sortable = count > 1;
  const failureWords =
    failure === null
      ? ""
      : failedAgo === ""
        ? t(failure.label)
        : t("{{failure}} {{age}}", { failure: t(failure.label), age: failedAgo });
  const failureHelp =
    failure === null
      ? ""
      : t("{{failure}}. {{advice}}", { failure: failureWords, advice: fixOf(provider, t) });
  const heading = [
    name,
    provider.model,
    provider.has_key ? t("has a key") : local ? t("on this Mac") : "",
    failureWords,
    provider.enabled ? "" : t("off"),
  ]
    .filter(Boolean)
    .join(t(", "));
  const FailureIcon = provider.failure === "unreachable" ? WifiSlashIcon : WarningCircleIcon;

  const edit = (next: Editing) => {
    setEditing(next);
    setModel(provider.model);
    setKey("");
    setFailureToReport(undefined);
    notes.tell("");
  };
  const run = (
    call: Promise<AiProvider | undefined>,
    then: (saved?: AiProvider) => void,
    fallback?: string,
  ) => {
    setBusy(true);
    setFailureToReport(undefined);
    call.then(
      (saved) => {
        setBusy(false);
        then(saved);
      },
      (cause: unknown) => {
        setBusy(false);
        setFailureToReport({ cause, fallback });
      },
    );
  };
  const saveModel = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(api.changeAiModel(provider.id, model.trim()), (saved) => {
      if (saved !== undefined) {
        onChanged(saved);
      }
      setEditing(null);
      notes.confirm("Model saved.");
    });
  };
  const saveKey = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    run(
      api.replaceAiKey(provider.id, key.trim()),
      (saved) => {
        if (saved !== undefined) {
          onChanged(saved);
        }
        setKey("");
        setEditing(null);
        notes.confirm("Key saved.");
      },
      "Could not change the key. Try again.",
    );
  };
  const remove = () => {
    run(api.removeAiProvider(provider.id), onRemoved);
  };
  const turn = (enabled: boolean) => {
    run(api.setAiEnabled(provider.id, enabled), (saved) => {
      if (saved !== undefined) {
        onChanged(saved);
      }
    });
  };

  const removal = t(
    provider.has_key ? "Remove {{name}} and delete its key from this Mac?" : "Remove {{name}}?",
    { name },
  );
  const removalWarning = enabledAfterRemoval
    ? removal
    : count === 1
      ? t(
          provider.enabled
            ? "{{removal}} Suggestions stop until another provider is added."
            : "{{removal}} Suggestions remain off until another provider is added.",
          { removal },
        )
      : t(
          provider.enabled
            ? "{{removal}} Suggestions stop unless you enable another provider."
            : "{{removal}} Suggestions remain off unless you enable another provider.",
          { removal },
        );
  const error =
    failureToReport === undefined
      ? ""
      : providerError(failureToReport.cause, failureToReport.fallback, t);

  return (
    <li
      ref={setNodeRef}
      className={["ai-provider", open && "open", !provider.enabled && "off"]
        .filter(Boolean)
        .join(" ")}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="ai-provider-bar">
        {sortable && (
          <button
            type="button"
            className="icon ai-provider-handle"
            ref={setActivatorNodeRef}
            aria-label={t("Reorder {{name}}", { name })}
            title={t("Drag to reorder")}
            {...attributes}
            {...listeners}
            aria-roledescription={t("sortable")}
            data-sortable-handle=""
          >
            <DotsSixVerticalIcon weight="bold" aria-hidden />
          </button>
        )}
        <button
          type="button"
          className="ai-provider-head"
          aria-label={heading}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
        >
          <span className="ai-provider-place" aria-hidden>
            {place}
          </span>
          <strong className="ai-provider-name">{name}</strong>
          <span className="ai-provider-model">{provider.model}</span>
          {provider.has_key ? (
            <span className="ai-provider-mark" title={t("Has a key, kept in the Keychain")}>
              <KeyIcon weight="fill" aria-hidden />
            </span>
          ) : (
            local && (
              <span className="ai-provider-mark" title={t("On this Mac, so it needs no key")}>
                <HouseLineIcon aria-hidden />
              </span>
            )
          )}
          {failure !== null && (
            <span className="ai-provider-failure" title={failureHelp}>
              <FailureIcon weight="bold" aria-hidden />
            </span>
          )}
          <CaretDownIcon className="ai-provider-caret" aria-hidden />
        </button>
        <input
          type="checkbox"
          role="switch"
          className="ai-provider-switch"
          aria-label={t("Ask {{name}}", { name })}
          title={t(
            provider.enabled
              ? "Asked; turn off to skip {{name}}"
              : "Skipped; turn on to ask {{name}}",
            { name },
          )}
          checked={provider.enabled}
          disabled={busy}
          onChange={(event) => {
            turn(event.target.checked);
          }}
        />
        {sortable && (
          <span className="ai-provider-moves">
            <button
              type="button"
              className="icon"
              aria-label={t("Move {{name}} up", { name })}
              title={t("Ask earlier")}
              disabled={place === 1}
              onClick={() => {
                onMove(-1);
              }}
            >
              <ArrowUpIcon aria-hidden />
            </button>
            <button
              type="button"
              className="icon"
              aria-label={t("Move {{name}} down", { name })}
              title={t("Ask later")}
              disabled={place === count}
              onClick={() => {
                onMove(1);
              }}
            >
              <ArrowDownIcon aria-hidden />
            </button>
          </span>
        )}
      </div>
      <div id={bodyId} className="ai-provider-body" hidden={!open}>
        {failure !== null && <p className="ai-provider-why">{failureHelp}</p>}
        <div className="ai-provider-row">
          <label className="mark-name">
            {t("Base URL")}
            <input type="url" readOnly value={provider.base_url} />
          </label>
        </div>
        <form className="ai-provider-row" onSubmit={saveModel}>
          <label className="mark-name">
            {t("Model")}
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              readOnly={editing !== "model"}
              maxLength={128}
              value={editing === "model" ? model : provider.model}
              onChange={(event) => {
                setModel(event.target.value);
              }}
            />
          </label>
          <span className="ai-provider-actions">
            {editing === "model" ? (
              <>
                <button
                  type="submit"
                  aria-label={t("Save model")}
                  disabled={busy || model.trim() === ""}
                >
                  {t("Save")}
                </button>
                <button
                  type="button"
                  className="secondary outline"
                  onClick={() => {
                    edit(null);
                  }}
                >
                  {t("Cancel")}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="secondary outline"
                onClick={() => {
                  edit("model");
                }}
              >
                {t("Change model")}
              </button>
            )}
          </span>
        </form>
        <form className="ai-provider-row" onSubmit={saveKey}>
          {editing === "key" ? (
            <>
              <label className="mark-name">
                {t("New key")}
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={512}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value);
                  }}
                />
              </label>
              <span className="ai-provider-actions">
                <button
                  type="submit"
                  aria-label={t("Save key")}
                  disabled={busy || key.trim() === ""}
                >
                  {t("Save")}
                </button>
                <button
                  type="button"
                  className="secondary outline"
                  onClick={() => {
                    edit(null);
                  }}
                >
                  {t("Cancel")}
                </button>
              </span>
            </>
          ) : (
            <>
              <label className="mark-name">
                {t("Key")}
                <input
                  type="text"
                  readOnly
                  value={t(
                    provider.has_key ? "Kept in the Keychain" : local ? "None needed" : "None",
                  )}
                />
              </label>
              <span className="ai-provider-actions">
                <button
                  type="button"
                  className="secondary outline"
                  onClick={() => {
                    edit("key");
                  }}
                >
                  {t(provider.has_key ? "Replace key" : "Add a key")}
                </button>
              </span>
            </>
          )}
        </form>
        {editing === "remove" ? (
          <p className="ai-provider-confirm" role="group" aria-label={t("Remove")}>
            <span>{removalWarning}</span>
            <button
              type="button"
              className="ai-provider-remove-now"
              disabled={busy}
              onClick={remove}
            >
              {t("Remove")}
            </button>
            <button
              type="button"
              className="secondary outline"
              onClick={() => {
                edit(null);
              }}
            >
              {t("Cancel")}
            </button>
          </p>
        ) : (
          <p className="ai-provider-confirm">
            <button
              type="button"
              className="secondary outline ai-provider-remove"
              onClick={() => {
                edit("remove");
              }}
            >
              {t("Remove")}
            </button>
          </p>
        )}
        <p className={classOf(notes.note)} role="status">
          {notes.note.text === "" ? "" : t(notes.note.text)}
        </p>
      </div>
      {error !== "" && <p role="alert">{error}</p>}
    </li>
  );
}
