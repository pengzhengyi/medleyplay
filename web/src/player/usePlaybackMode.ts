/** @file Choose which player a LAN browser controls without moving either queue. */

import { useLayoutEffect, useRef, useState } from "react";

import type { LiveUpdates } from "../library/useLibrary";
import type { DeviceConnection } from "../listen";
import { type ModePicker, type PlaysOn } from "../views/PlayOn";
import { COMPUTER_READY } from "../views/unplayable";
import { type Speaker, takeOf } from "./remote";
import type { Player } from "./usePlayer";
import { useRemotePlayer } from "./useRemotePlayer";

export function usePlaybackMode(
  local: Player,
  setLocalAudio: (enabled: boolean) => void,
  connection: DeviceConnection,
  live: LiveUpdates,
  reported: Speaker | null | undefined,
  onSignedOut: () => void,
) {
  const [on, setOn] = useState<PlaysOn>("here");
  const [failed, setFailed] = useState("");
  const [moving, setMoving] = useState<string>();
  const moveInFlight = useRef<symbol>(undefined);
  const shared = connection === "lan";
  const speaker = shared && live === "connected" ? (reported ?? null) : null;
  const page = speaker?.page;
  const [lastPage, setLastPage] = useState(page);
  if (page !== lastPage) {
    setLastPage(page);
    setMoving(undefined);
  }
  useLayoutEffect(
    () => () => {
      moveInFlight.current = undefined;
    },
    [page],
  );
  const [remote, remoteSleep, command] = useRemotePlayer(speaker, on === "computer", onSignedOut);
  const player = on === "computer" ? remote : local;
  const busy = moving !== undefined;
  const choose = (where: PlaysOn) => {
    if (busy || moveInFlight.current !== undefined || where === on) return;
    if (where === "computer" && page === undefined) return;
    setFailed("");
    setLocalAudio(where === "here");
    setOn(where);
  };
  const move =
    page === undefined || player.status.kind !== "playing"
      ? undefined
      : () => {
          if (busy || moveInFlight.current !== undefined) return;
          const handoff = player.handoff();
          if (handoff === undefined) return;
          const token = Symbol();
          moveInFlight.current = token;
          setFailed("");
          setMoving(page);
          const goingLocal = on === "computer";
          void command(goingLocal ? { kind: "pause" } : takeOf(handoff, true))
            .then(
              () => {
                if (moveInFlight.current !== token) return;
                setLocalAudio(goingLocal);
                if (goingLocal) local.take(handoff, true);
                setOn(goingLocal ? "here" : "computer");
              },
              (error: unknown) => {
                if (moveInFlight.current === token) {
                  setFailed(error instanceof Error ? error.message : String(error));
                }
              },
            )
            .finally(() => {
              if (moveInFlight.current !== token) return;
              moveInFlight.current = undefined;
              setMoving(undefined);
            });
        };
  const picker: ModePicker = {
    on,
    busy,
    available: speaker !== null,
    unavailable:
      connection === "unknown"
        ? "Device connection type is unknown."
        : live === "reconnecting"
          ? "Waiting for live updates to reconnect."
          : reported === undefined
            ? "Checking for the computer's player…"
            : speaker === null
              ? COMPUTER_READY
              : undefined,
    onChoose: choose,
  };
  return { player, picker, remote, remoteSleep, failed, move };
}
