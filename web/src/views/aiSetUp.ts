/**
 * @file Whether an AI provider is set up, given by context, so each button that asks
 * the AI can say how to set one up without every page in between passing it along.
 */

import { createContext, use } from "react";

export interface AiSetUp {
  /** Whether the server said no provider is set up and turned on; false until it says. */
  readonly missing: boolean;
  /** Whether the listener is an admin, who sets providers up in Settings. */
  readonly admin: boolean;
  /** Ask the server again whether a provider is set up; resolves to whether one is. */
  readonly recheck?: () => Promise<boolean>;
}

export const AiSetUpContext = createContext<AiSetUp>({ missing: false, admin: false });

/** Why a button that asks the AI can't, for an admin and for a member. */
const WHY_ADMIN = "No AI provider is set up; set one up in Settings";
const WHY_MEMBER = "No AI provider is set up; an admin sets one up in Settings";

/**
 * Return whether no AI provider is set up, whether the listener is an admin, why a
 * button can't ask, and `whenSetUp`, which runs `ask` at once while one is set up, and
 * otherwise only once the server, asked again, says one has been since.
 */
export function useAiSetUp(): AiSetUp & {
  readonly why: string;
  readonly whenSetUp: (ask: () => void) => void;
} {
  const setUp = use(AiSetUpContext);
  const whenSetUp = (ask: () => void) => {
    if (!setUp.missing) {
      ask();
      return;
    }
    void (setUp.recheck?.() ?? Promise.resolve(false)).then((now) => {
      if (now) {
        ask();
      }
    });
  };
  return { ...setUp, why: setUp.admin ? WHY_ADMIN : WHY_MEMBER, whenSetUp };
}
