/**
 * @file Signing in, or creating the first Account on a new server.
 */

import { WaveformIcon } from "@phosphor-icons/react";
import { type SubmitEvent, useEffect, useId, useState } from "react";

import { type Account, ApiError, api } from "../api";
import { type Words, useWords } from "../locale";
import { LanguageSelect } from "./LanguageSelect";

const USERNAME_RULE =
  "Use 1 to 32 characters: letters (A–Z), digits, periods, underscores, or hyphens. Start with a letter or digit.";
const DISPLAY_NAME_RULE = "Use 1 to 64 characters. This is the name shown in the app.";
const PASSWORD_RULE = "Use 8 to 256 characters.";
type SignInFailure =
  | { readonly kind: "unreachable" }
  | { readonly kind: "request"; readonly cause: unknown; readonly settingUp: boolean };

function messageFor(failure: SignInFailure, t: Words): string {
  if (failure.kind === "unreachable") return t("The server can't be reached.");
  const { cause, settingUp } = failure;
  if (cause instanceof ApiError) {
    if (
      !settingUp &&
      cause.status === 401 &&
      cause.message === "The username or password is wrong."
    ) {
      return t(cause.message);
    }
    if (settingUp && cause.status === 422) {
      if (
        cause.message === "A display name must be 1-64 characters." ||
        cause.message === "A password must be 8-256 characters."
      ) {
        return t(cause.message);
      }
      if (
        /^Username .+ must be 1-32 letters, digits, '\.', '_', or '-', starting with a letter or digit\.$/u.test(
          cause.message,
        )
      ) {
        return t(USERNAME_RULE);
      }
    }
    if (
      settingUp &&
      cause.status === 409 &&
      cause.message === "medleyplay is already set up; an admin creates new Accounts."
    ) {
      return t(
        "medleyplay is already set up. No account was created. If you already have an account, reload to sign in. Otherwise, ask the admin to create one.",
      );
    }
  }
  return t(
    settingUp ? "Could not create the first account. Try again." : "Could not sign in. Try again.",
  );
}

/** The sign-in form; on a server with no Accounts yet, the form that creates the admin. */
export function SignIn({ onSignedIn }: { readonly onSignedIn: (account: Account) => void }) {
  const t = useWords();
  const help = useId();
  const [setUp, setSetUp] = useState<boolean | undefined>(undefined);
  const [failure, setFailure] = useState<SignInFailure>();
  const [statusCheck, setStatusCheck] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let current = true;
    api.setupStatus().then(
      (status) => {
        if (current) setSetUp(status.set_up);
      },
      () => {
        if (current) setFailure({ kind: "unreachable" });
      },
    );
    return () => {
      current = false;
    };
  }, [statusCheck]);

  const submit = (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || setUp === undefined) return;
    const form = new FormData(event.currentTarget);
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    setBusy(true);
    setFailure(undefined);
    const signingIn = setUp
      ? api.signIn(field("username"), field("password"))
      : api.setUp(field("username"), field("display_name"), field("password"));
    signingIn.then(onSignedIn, (cause: unknown) => {
      setFailure({ kind: "request", cause, settingUp: !setUp });
      setBusy(false);
    });
  };

  const firstRun = setUp === false;
  return (
    <main className="sign-in">
      <h1>
        <WaveformIcon weight="bold" aria-hidden />
        medleyplay
      </h1>
      <LanguageSelect />
      {setUp === undefined ? (
        failure === undefined ? (
          <p role="status" aria-busy="true">
            {t("Checking whether medleyplay is set up…")}
          </p>
        ) : (
          <>
            <p role="alert">{messageFor(failure, t)}</p>
            <button
              type="button"
              onClick={() => {
                setFailure(undefined);
                setStatusCheck((previous) => previous + 1);
              }}
            >
              {t("Retry setup check")}
            </button>
          </>
        )
      ) : (
        <form
          onSubmit={submit}
          aria-label={t(firstRun ? "Create the admin Account" : "Sign in")}
          aria-busy={busy}
        >
          {firstRun && <p>{t("Create the first Account. It is the admin.")}</p>}
          <label>
            {t("Username")}
            <input
              name="username"
              autoComplete="username"
              required
              aria-describedby={firstRun ? `${help}-username` : undefined}
            />
          </label>
          {firstRun && (
            <small className="hint" id={`${help}-username`}>
              {t(USERNAME_RULE)}
            </small>
          )}
          {firstRun && (
            <label>
              {t("Display name")}
              <input
                name="display_name"
                autoComplete="name"
                required
                aria-describedby={`${help}-display-name`}
              />
            </label>
          )}
          {firstRun && (
            <small className="hint" id={`${help}-display-name`}>
              {t(DISPLAY_NAME_RULE)}
            </small>
          )}
          <label>
            {t("Password")}
            <input
              name="password"
              type="password"
              autoComplete={firstRun ? "new-password" : "current-password"}
              required
              aria-describedby={firstRun ? `${help}-password` : undefined}
            />
          </label>
          {firstRun && (
            <small className="hint" id={`${help}-password`}>
              {t(PASSWORD_RULE)}
            </small>
          )}
          {failure !== undefined && <p role="alert">{messageFor(failure, t)}</p>}
          <button type="submit" disabled={busy}>
            {t(firstRun ? "Create Account" : "Sign in")}
          </button>
        </form>
      )}
    </main>
  );
}
