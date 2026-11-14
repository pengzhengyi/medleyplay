/**
 * @file One saved AI provider, as a card in the order providers are asked.
 *
 * Closed, the card shows the provider's place, name, model, and key, and why it last
 * failed. Opened, it shows the address and model as read-only fields, and the few
 * things that can change while keeping its place: its model, its key, or removing it.
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
} from "@phosphor-icons/react";
import { type SubmitEvent, useId, useState } from "react";

import { FAILURE_WORDS, agoOf, fixOf, isLocal } from "../aiProviders";
import { type AiProvider, api } from "../api";
import { classOf, useNote } from "../useNote";
import { useNow } from "../useNow";

type Editing = "model" | "key" | "remove" | null;

export function AiProviderCard({
  provider,
  name,
  place,
  count,
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
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onMove: (by: -1 | 1) => void;
  /** Called with the provider as saved after its model or key changed. */
  readonly onChanged: (saved: AiProvider) => void;
  readonly onRemoved: () => void;
}) {
  const bodyId = useId();
  const now = useNow();
  const [editing, setEditing] = useState<Editing>(null);
  const [model, setModel] = useState(provider.model);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const notes = useNote();
  const [error, setError] = useState("");
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } =
    useSortable({ id: provider.id });

  const local = isLocal(provider.base_url);
  const failure = provider.failure === null ? null : FAILURE_WORDS[provider.failure];
  const failedAgo = provider.failed_at === null ? "" : agoOf(provider.failed_at, now);
  const sortable = count > 1;
  const keyWords = provider.has_key ? ", has a key" : local ? ", on this Mac" : "";
  const failureWords = failure === null ? "" : `, ${failure.label} ${failedAgo}`;
  const heading = `${name}, ${provider.model}${keyWords}${failureWords}`;

  const edit = (next: Editing) => {
    setEditing(next);
    setModel(provider.model);
    setKey("");
    setError("");
    notes.tell("");
  };
  const run = (call: Promise<AiProvider | undefined>, then: (saved?: AiProvider) => void) => {
    setBusy(true);
    setError("");
    call.then(
      (saved) => {
        setBusy(false);
        then(saved);
      },
      (failure: unknown) => {
        setBusy(false);
        setError(failure instanceof Error ? failure.message : String(failure));
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
    run(api.replaceAiKey(provider.id, key.trim()), (saved) => {
      if (saved !== undefined) {
        onChanged(saved);
      }
      setKey("");
      setEditing(null);
      notes.confirm("Key saved.");
    });
  };
  const remove = () => {
    run(api.removeAiProvider(provider.id), onRemoved);
  };

  const removal =
    (provider.has_key ? `Remove ${name} and delete its key from this Mac?` : `Remove ${name}?`) +
    (count === 1 ? " Suggestions stop until another provider is added." : "");

  return (
    <li
      ref={setNodeRef}
      className={open ? "ai-provider open" : "ai-provider"}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="ai-provider-bar">
        {sortable && (
          <button
            type="button"
            className="icon ai-provider-handle"
            ref={setActivatorNodeRef}
            aria-label={`Reorder ${name}`}
            title="Drag to reorder"
            {...attributes}
            {...listeners}
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
            <span className="ai-provider-mark" title="Has a key, kept in the Keychain">
              <KeyIcon weight="fill" aria-hidden />
            </span>
          ) : (
            local && (
              <span className="ai-provider-mark" title="On this Mac, so it needs no key">
                <HouseLineIcon aria-hidden />
              </span>
            )
          )}
          {failure !== null && (
            <span className="ai-provider-failure" title={fixOf(provider)}>
              <WarningCircleIcon weight="fill" aria-hidden />
              {failure.label} {failedAgo}
            </span>
          )}
          <CaretDownIcon className="ai-provider-caret" aria-hidden />
        </button>
        {sortable && (
          <span className="ai-provider-moves">
            <button
              type="button"
              className="icon"
              aria-label={`Move ${name} up`}
              title="Ask earlier"
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
              aria-label={`Move ${name} down`}
              title="Ask later"
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
        {failure !== null && (
          <p className="ai-provider-why">
            {failure.label} {failedAgo}. {fixOf(provider)}
          </p>
        )}
        <label className="mark-name">
          Base URL
          <input type="url" readOnly value={provider.base_url} />
        </label>
        <form className="ai-provider-row" onSubmit={saveModel}>
          <label className="mark-name">
            Model
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
          {editing === "model" ? (
            <>
              <button type="submit" disabled={busy || model.trim() === ""}>
                Save model
              </button>
              <button
                type="button"
                className="secondary outline"
                onClick={() => {
                  edit(null);
                }}
              >
                Cancel
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
              Change model
            </button>
          )}
        </form>
        <form className="ai-provider-row" onSubmit={saveKey}>
          {editing === "key" ? (
            <>
              <label className="mark-name">
                New key
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
              <button type="submit" disabled={busy || key.trim() === ""}>
                Save key
              </button>
              <button
                type="button"
                className="secondary outline"
                onClick={() => {
                  edit(null);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <label className="mark-name">
                Key
                <input
                  type="text"
                  readOnly
                  value={provider.has_key ? "Kept in the Keychain" : local ? "None needed" : "None"}
                />
              </label>
              <button
                type="button"
                className="secondary outline"
                onClick={() => {
                  edit("key");
                }}
              >
                {provider.has_key ? "Replace key" : "Add a key"}
              </button>
            </>
          )}
        </form>
        {editing === "remove" ? (
          <p className="ai-provider-row ai-provider-confirm" role="group" aria-label="Remove">
            <span>{removal}</span>
            <button
              type="button"
              className="ai-provider-remove-now"
              disabled={busy}
              onClick={remove}
            >
              Remove
            </button>
            <button
              type="button"
              className="secondary outline"
              onClick={() => {
                edit(null);
              }}
            >
              Cancel
            </button>
          </p>
        ) : (
          <p className="ai-provider-row">
            <button
              type="button"
              className="secondary outline ai-provider-remove"
              onClick={() => {
                edit("remove");
              }}
            >
              Remove
            </button>
          </p>
        )}
        {error !== "" && <p role="alert">{error}</p>}
        <p className={classOf(notes.note)} role="status">
          {notes.note.text}
        </p>
      </div>
    </li>
  );
}
