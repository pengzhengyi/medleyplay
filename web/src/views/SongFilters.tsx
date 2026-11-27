/**
 * @file The song table's filters: native controls, so a phone offers its own pickers.
 *
 * Each picker counts the choices from its own set of rows.
 */

import { FunnelSimpleIcon, XIcon } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { afterNextPaint } from "../library/stages";
import { type ChoiceField, type ChoiceRows, choicesFor } from "./filterChoices";
import { type Words, useWords } from "../locale";

/** A rating filter: at least so many stars, or no rating. */
export type RatingFilter = 1 | 2 | 3 | 4 | 5 | "unrated";

/** The filters on; a field left out keeps every song. */
export interface Filters {
  readonly kind?: string;
  /** The artist's name as written, or every name one artist's songs are written by. */
  readonly artist?: string | readonly string[];
  readonly album?: string;
  readonly genre?: string;
  readonly year?: string;
  readonly rating?: RatingFilter;
  readonly favorite?: true;
  readonly playable?: true;
}

export type FilterField = keyof Filters;

const CHOICE_FIELDS: readonly { field: ChoiceField; label: string; any: string }[] = [
  { field: "kind", label: "Kind", any: "Songs and albums" },
  { field: "artist", label: "Artist", any: "Any artist" },
  { field: "album", label: "Album", any: "Any album" },
  { field: "genre", label: "Genre", any: "Any genre" },
  { field: "year", label: "Year", any: "Any year" },
];

const RATINGS: readonly { value: RatingFilter; label: string }[] = [
  { value: 1, label: "At least 1 star" },
  { value: 2, label: "At least 2 stars" },
  { value: 3, label: "At least 3 stars" },
  { value: 4, label: "At least 4 stars" },
  { value: 5, label: "5 stars" },
  { value: "unrated", label: "Unrated" },
];

/** The choice a filter's menu shows: its value, or the first of the names it keeps. */
const shownChoice = (value: string | readonly string[] | undefined): string =>
  typeof value === "string" ? value : (value?.[0] ?? "");

/** How a filter on reads, as its chip says it: `Artist: 朴树`, `Favorites only`. */
function describeFilter(field: FilterField, filters: Filters, t: Words): string {
  switch (field) {
    case "rating":
      return t("{{field}}: {{value}}", {
        field: t("Rating"),
        value: t(RATINGS.find((each) => each.value === filters.rating)?.label ?? ""),
      });
    case "favorite":
      return t("Favorites only");
    case "playable":
      return t("Only songs that play now");
    case "kind":
      return t(filters.kind === "album" ? "Albums only" : "Songs only");
    default: {
      const value = filters[field] ?? "";
      const said = typeof value === "string" ? value : value.join(" / ");
      return t("{{field}}: {{value}}", {
        field: t(CHOICE_FIELDS.find((each) => each.field === field)?.label ?? ""),
        value: said,
      });
    }
  }
}

/** The fields of `filters` that are on, in the order the panel lists them. */
function filtersOn(filters: Filters): FilterField[] {
  const order: FilterField[] = [
    "kind",
    "artist",
    "album",
    "genre",
    "year",
    "rating",
    "favorite",
    "playable",
  ];
  return order.filter((field) => filters[field] !== undefined);
}

/** The Filter button and its panel of controls. */
export function SongFilters({
  filters,
  choiceRows,
  prepare,
  onChange,
}: {
  readonly filters: Filters;
  readonly choiceRows: (field: ChoiceField) => ChoiceRows | undefined;
  readonly prepare: boolean;
  readonly onChange: (field: FilterField, value: Filters[FilterField]) => void;
}) {
  const t = useWords();
  const on = filtersOn(filters).length;
  const [prepared, setPrepared] = useState(0);
  useEffect(() => {
    if (!prepare || prepared === CHOICE_FIELDS.length) return undefined;
    return afterNextPaint(() => {
      setPrepared((count) => Math.min(count + 1, CHOICE_FIELDS.length));
    });
  }, [prepare, prepared]);
  return (
    <details
      className="dropdown filter-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) setPrepared(CHOICE_FIELDS.length);
      }}
    >
      <summary
        className="filter-summary"
        aria-label={on > 0 ? t("Filter, {{count}} on", { count: on }) : undefined}
      >
        <FunnelSimpleIcon weight={on > 0 ? "fill" : "regular"} aria-hidden />
        {t("Filter")}
        {on > 0 && (
          <span className="filter-count" aria-hidden>
            {on}
          </span>
        )}
      </summary>
      <div className="filter-panel" role="group" aria-label={t("Filters")}>
        {CHOICE_FIELDS.slice(0, prepared).map(({ field, label, any }) => (
          <ChoicePicker
            key={field}
            field={field}
            label={t(label)}
            any={t(any)}
            rows={choiceRows(field)}
            value={shownChoice(filters[field])}
            onChange={(value) => {
              onChange(field, value === "" ? undefined : value);
            }}
          />
        ))}
        <label className="filter-field">
          {t("Rating")}
          <select
            className="filter-select"
            value={filters.rating === undefined ? "" : String(filters.rating)}
            onChange={(event) => {
              const { value } = event.target;
              onChange(
                "rating",
                value === ""
                  ? undefined
                  : value === "unrated"
                    ? "unrated"
                    : (Number(value) as RatingFilter),
              );
            }}
          >
            <option value="">{t("Any rating")}</option>
            {RATINGS.map((rating) => (
              <option key={rating.value} value={String(rating.value)}>
                {t(rating.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-check">
          <input
            className="filter-check-input"
            type="checkbox"
            checked={filters.favorite === true}
            onChange={(event) => {
              onChange("favorite", event.target.checked ? true : undefined);
            }}
          />
          {t("Favorites only")}
        </label>
        <label className="filter-check">
          <input
            className="filter-check-input"
            type="checkbox"
            checked={filters.playable === true}
            onChange={(event) => {
              onChange("playable", event.target.checked ? true : undefined);
            }}
          />
          {t("Only songs that play now")}
        </label>
      </div>
    </details>
  );
}

function ChoicePicker({
  field,
  label,
  any,
  rows,
  value,
  onChange,
}: {
  readonly field: ChoiceField;
  readonly label: string;
  readonly any: string;
  readonly rows: ChoiceRows | undefined;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const t = useWords();
  const choices = useMemo(() => choicesFor(field, rows), [field, rows]);
  const select = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    const picker = select.current;
    if (picker === null) return;
    const options = picker.ownerDocument.createDocumentFragment();
    options.append(new Option(any, ""));
    for (const choice of choices) {
      const name = field === "kind" ? t(choice.label) : choice.label;
      options.append(
        new Option(t("{{name}} ({{count}})", { name, count: choice.count }), choice.value),
      );
    }
    picker.replaceChildren(options);
    picker.value = value;
    if (picker.selectedIndex < 0) picker.selectedIndex = 0;
  }, [any, choices, field, t, value]);
  return (
    <label className="filter-field">
      {label}
      <select
        ref={select}
        className="filter-select"
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
      />
    </label>
  );
}

/** How many of the songs the filters keep, each filter on as a chip to remove, and a way to clear them. */
export function FiltersOn({
  filters,
  shown,
  total,
  counted = "songs",
  onRemove,
  onClear,
}: {
  readonly filters: Filters;
  readonly shown: number;
  readonly total: number;
  /** What is counted, such as *songs and albums* in the Library. */
  readonly counted?: string;
  readonly onRemove: (field: FilterField) => void;
  readonly onClear: () => void;
}) {
  const t = useWords();
  const on = filtersOn(filters);
  const [cleared, setCleared] = useState<"one" | "all">();
  return (
    <div className={on.length === 0 ? "visually-hidden" : "filters-on"}>
      <span className="filtered-count" role="status">
        {on.length > 0
          ? t("{{shown}} of {{total}} {{items}}", { shown, total, items: t(counted) })
          : cleared === undefined
            ? ""
            : t(cleared === "all" ? "Filters cleared." : "Filter removed.")}
      </span>
      {on.map((field) => {
        const label = describeFilter(field, filters, t);
        return (
          <button
            key={field}
            type="button"
            className="chip"
            aria-label={t("Remove the filter {{label}}", { label })}
            onClick={() => {
              setCleared("one");
              onRemove(field);
            }}
          >
            {label}
            <XIcon weight="bold" aria-hidden />
          </button>
        );
      })}
      {on.length > 0 && (
        <button
          type="button"
          className="clear-filters"
          onClick={() => {
            setCleared("all");
            onClear();
          }}
        >
          {t("Clear filters")}
        </button>
      )}
    </div>
  );
}
