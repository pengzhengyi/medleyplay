/**
 * @file A button that has the server read the network and check the internet now.
 */

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";

import { type Mode, api } from "../api";
import { useWords } from "../locale";

/**
 * Check the network now, then pass on the Mode it comes to; `said` shows beside the
 * icon, which otherwise stands alone. While checking, the icon turns.
 */
export function CheckNetwork({
  onChecked,
  said,
}: {
  readonly onChecked: (mode: Mode) => void;
  readonly said?: string;
}) {
  const t = useWords();
  const [checking, setChecking] = useState(false);
  const [failure, setFailure] = useState("");

  const check = () => {
    setChecking(true);
    setFailure("");
    api
      .checkMode()
      .then(onChecked, (error: unknown) => {
        setFailure(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setChecking(false);
      });
  };

  const label = checking
    ? t("Checking the network")
    : failure === ""
      ? t("Check the network")
      : t("Couldn't check the network: {{failure}} Check again", { failure });
  return (
    <button
      type="button"
      className={said === undefined ? "mode-check" : "secondary outline check-network"}
      aria-label={said === undefined ? label : undefined}
      title={label}
      disabled={checking}
      onClick={check}
    >
      <ArrowClockwiseIcon weight="bold" className={checking ? "spin" : undefined} aria-hidden />
      {said}
    </button>
  );
}
