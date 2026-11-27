/**
 * @file Beside a button that asks the AI, while no provider is set up: a link to
 * Settings' AI section for an admin, or a word to ask one for a member.
 */

import { hrefOf } from "../routes";
import { useAiSetUp } from "./aiSetUp";
import { useWords } from "../locale";

/**
 * The hint, or nothing while a provider is set up or the server hasn't said; with
 * `newTab`, as in a dialog, the link opens Settings in a new tab, keeping what is typed.
 */
export function AiSetUpHint({ newTab = false }: { readonly newTab?: boolean }) {
  const t = useWords();
  const { missing, admin, why } = useAiSetUp();
  if (!missing) {
    return null;
  }
  return admin ? (
    <a
      className="ai-set-up-hint"
      href={hrefOf({ view: "settings", section: "ai" })}
      title={why}
      {...(newTab && { target: "_blank", rel: "noopener" })}
    >
      {t("Set up AI")}
    </a>
  ) : (
    <small className="ai-set-up-hint" title={why}>
      {t("Ask an admin to set up AI")}
    </small>
  );
}
