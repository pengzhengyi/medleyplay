/**
 * @file The AI section of Settings, for an admin: the provider that suggests a Track's
 * details, and the suggestion for every Track that can have one.
 *
 * The provider is any service that speaks the OpenAI chat protocol: DeepSeek, OpenAI,
 * Anthropic, or a local Ollama. Its key is typed into a password field, kept in the
 * Keychain, and never shown again: the section shows only whether there is one.
 */

import { type SubmitEvent, useEffect, useEffectEvent, useState } from "react";

import { AI_ENRICHER, type AiSetting, api } from "../api";
import { EnricherSettings, type EnricherWords } from "./EnricherSettings";

const number = new Intl.NumberFormat("en-US");

const WORDS: EnricherWords = {
  enricher: AI_ENRICHER,
  site: "the AI provider",
  heading: "Suggestions",
  description: (
    <>
      Suggest details with AI asks the provider for a song&apos;s title, artist, album, year, and
      song list. What it says is only a suggestion: it shows beside each detail in Edit details and
      changes nothing until someone uses it. It asks only when someone chooses it, one Track at a
      time, at most once every two seconds, and never about the same text twice in a day.
    </>
  ),
  findAll: "Suggest for all",
  count: (tracks) =>
    tracks === 1
      ? "1 Track can be given suggestions."
      : `${String(tracks)} Tracks can be given suggestions.`,
  off: "Suggesting details with AI is turned off.",
};

/**
 * The provider, a form to set it, and the suggestions for every Track. `onChanged` is
 * called after the provider changes, since that changes which Tracks can be suggested for.
 */
export function AiSettings({ onChanged }: { readonly onChanged: () => void }) {
  const [setting, setSetting] = useState<AiSetting | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [key, setKey] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const failed = (failure: unknown) => {
    setError(failure instanceof Error ? failure.message : String(failure));
  };
  const read = (then = "") => {
    api.ai().then((answer) => {
      setSetting(answer);
      setBaseUrl(answer.provider?.base_url ?? "");
      setModel(answer.provider?.model ?? "");
      setNote(then);
    }, failed);
  };
  const loadOnOpen = useEffectEvent(() => {
    read();
  });
  useEffect(() => {
    loadOnOpen();
  }, []);

  const save = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const typed = key.trim();
    api.saveAi(baseUrl.trim(), model.trim(), typed === "" ? undefined : typed).then(() => {
      setKey("");
      read("Saved.");
      onChanged();
    }, failed);
  };
  const removeKey = () => {
    setError("");
    api.removeAiKey().then(() => {
      read("Key removed.");
      onChanged();
    }, failed);
  };

  const provider = setting?.provider ?? null;
  return (
    <>
      <h4>Provider</h4>
      {error !== "" && <p role="alert">{error}</p>}
      {setting === null ? (
        error === "" && (
          <p className="hint" aria-busy="true">
            Reading the provider…
          </p>
        )
      ) : (
        <>
          <p className="hint">
            A video&apos;s title, description, and chapters are sent to the provider you set here,
            with the file&apos;s name, the Track&apos;s length, and the details it shows. Only the
            first {number.format(setting.max_description)} characters of the description are sent.
          </p>
          <p>{provider === null ? "No AI provider is set up." : "An AI provider is set up."}</p>
          <p>{provider?.has_key === true ? "A key is set." : "No key is set."}</p>
          <p className="ai-presets" role="group" aria-label="Start from">
            {setting.presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="secondary outline"
                onClick={() => {
                  setBaseUrl(preset.base_url);
                  setModel(preset.model);
                }}
              >
                {preset.name}
              </button>
            ))}
          </p>
          <form className="proxy-form" onSubmit={save}>
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
              {provider?.has_key === true ? "New key" : "Key"}
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
              Save provider
            </button>
            {provider?.has_key === true && (
              <button type="button" className="secondary outline" onClick={removeKey}>
                Remove key
              </button>
            )}
            <p className="hint">
              The key is kept in the Keychain and never shown again; leave it empty to keep the one
              that is set. A local Ollama needs none. Plain http is for an address on this machine
              only.
            </p>
          </form>
          <p className="hint" role="status">
            {note}
          </p>
        </>
      )}
      <EnricherSettings words={WORDS} />
    </>
  );
}
