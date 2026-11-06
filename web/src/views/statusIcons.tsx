/** @file The mark of each state a lookup shows, wherever it shows it. */

import { CheckIcon, CircleNotchIcon, ClockIcon, WarningCircleIcon } from "@phosphor-icons/react";

import type { CoverStatus } from "../library/lookups";

/** A spinner while it looks, a clock while it waits, a check once done, a warning if it failed. */
export const STATUS_ICONS: Readonly<Record<CoverStatus["kind"], React.ReactElement>> = {
  looking: <CircleNotchIcon weight="bold" className="spin" aria-hidden />,
  waiting: <ClockIcon weight="bold" aria-hidden />,
  done: <CheckIcon weight="bold" aria-hidden />,
  failed: <WarningCircleIcon weight="fill" aria-hidden />,
};
