import { describe, expect, it } from "vitest";

import { enricherOf } from "../testing/server";
import { askingAt } from "./asking";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const AN_HOUR = 60 * 60 * 1000;

/** The AI, which may be asked about Tracks 1 and 2, having asked about Track 1 at some time. */
function theAiAsked(waitsUntil: number) {
  return enricherOf("ai-details", [1, 2], {
    waiting: { "1": new Date(waitsUntil).toISOString() },
    asks_again: true,
  });
}

describe("which Tracks an enricher may be asked about now", () => {
  it("offers a Track never asked about, and nothing changes with time", () => {
    const asking = askingAt(enricherOf("musicbrainz", [1]), NOW);

    expect(asking).toEqual({
      findable: new Set([1]),
      askedRecently: new Set(),
      changesAt: undefined,
    });
  });

  it("holds back a Track whose wait has not passed, and says when it will", () => {
    const asking = askingAt(theAiAsked(NOW + AN_HOUR), NOW);

    expect(asking.findable).toEqual(new Set([2]));
    expect(asking.changesAt).toBe(NOW + AN_HOUR);
  });

  it("lets someone choose to ask the AI again about a Track it waits for", () => {
    expect(askingAt(theAiAsked(NOW + AN_HOUR), NOW).askedRecently).toEqual(new Set([1]));
  });

  it("offers a Track again once its wait has passed", () => {
    const asking = askingAt(theAiAsked(NOW), NOW);

    expect(asking).toEqual({
      findable: new Set([1, 2]),
      askedRecently: new Set(),
      changesAt: undefined,
    });
  });

  it("lets no one ask a site other than the AI again before the wait passes", () => {
    const site = enricherOf("lyrics", [1], { waiting: { "1": "2026-11-21T12:00:00Z" } });

    expect(askingAt(site, NOW)).toEqual({
      findable: new Set(),
      askedRecently: new Set(),
      changesAt: Date.parse("2026-11-21T12:00:00Z"),
    });
  });

  it("changes when the first of several waits passes", () => {
    const enricher = enricherOf("lyrics", [1, 2], {
      waiting: {
        "1": new Date(NOW + 2 * AN_HOUR).toISOString(),
        "2": new Date(NOW + AN_HOUR).toISOString(),
      },
    });

    expect(askingAt(enricher, NOW).changesAt).toBe(NOW + AN_HOUR);
  });
});
