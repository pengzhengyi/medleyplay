/**
 * @file The song table's filters: native controls, so a phone offers its own pickers.
 *
 * It knows nothing of the table: it is given the choices each filter offers, with how
 * many songs each keeps, and the filters on, and says what changed.
 */

import { FunnelSimpleIcon, XIcon } from "@phosphor-icons/react";

/** A value a filter can keep, how it reads, and how many songs it keeps. */
export interface Choice {
  readonly value: string;
  readonly label: string;
  readonly count: number;
}

/** The fields a filter keeps one value of. */
export type ChoiceField = "artist" | "album" | "genre" | "year";

/** A rating filter: at least so many stars, or no rating. */
export type RatingFilter = 1 | 2 | 3 | 4 | 5 | "unrated";

/** The filters on; a field left out keeps every song. */
export interface Filters {
  readonly artist?: string;
  readonly album?: string;
  readonly genre?: string;
  readonly year?: string;
  readonly rating?: RatingFilter;
  readonly favorite?: true;
  readonly playable?: true;
}

export type FilterField = keyof Filters;

const CHOICE_FIELDS: readonly { field: ChoiceField; label: string; any: string }[] = [
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

/** How a filter on reads, as its chip says it: `Artist: 朴树`, `Favorites only`. */
function describeFilter(field: FilterField, filters: Filters): string {
  switch (field) {
    case "rating":
      return `Rating: ${RATINGS.find((each) => each.value === filters.rating)?.label ?? ""}`;
    case "favorite":
      return "Favorites only";
    case "playable":
      return "Only songs that play now";
    default:
      return `${CHOICE_FIELDS.find((each) => each.field === field)?.label ?? ""}: ${filters[field] ?? ""}`;
  }
}

/** The fields of `filters` that are on, in the order the panel lists them. */
function filtersOn(filters: Filters): FilterField[] {
  const order: FilterField[] = [
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
  choices,
  onChange,
}: {
  readonly filters: Filters;
  readonly choices: Readonly<Record<ChoiceField, readonly Choice[]>>;
  readonly onChange: (field: FilterField, value: Filters[FilterField]) => void;
}) {
  const on = filtersOn(filters).length;
  return (
    <details className="dropdown filter-menu">
      <summary
        className="filter-summary"
        aria-label={on > 0 ? `Filter, ${String(on)} on` : undefined}
      >
        <FunnelSimpleIcon weight={on > 0 ? "fill" : "regular"} aria-hidden />
        Filter
        {on > 0 && (
          <span className="filter-count" aria-hidden>
            {on}
          </span>
        )}
      </summary>
      <div className="filter-panel" role="group" aria-label="Filters">
        {CHOICE_FIELDS.map(({ field, label, any }) => (
          <label key={field} className="filter-field">
            {label}
            <select
              className="filter-select"
              value={filters[field] ?? ""}
              onChange={(event) => {
                onChange(field, event.target.value === "" ? undefined : event.target.value);
              }}
            >
              <option value="">{any}</option>
              {choices[field].map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {`${choice.label} (${String(choice.count)})`}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label className="filter-field">
          Rating
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
            <option value="">Any rating</option>
            {RATINGS.map((rating) => (
              <option key={rating.value} value={String(rating.value)}>
                {rating.label}
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
          Favorites only
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
          Only songs that play now
        </label>
      </div>
    </details>
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
  const on = filtersOn(filters);
  if (on.length === 0) {
    return null;
  }
  return (
    <div className="filters-on">
      <span className="filtered-count" role="status">
        {`${String(shown)} of ${String(total)} ${counted}`}
      </span>
      {on.map((field) => {
        const label = describeFilter(field, filters);
        return (
          <button
            key={field}
            type="button"
            className="chip"
            aria-label={`Remove the filter ${label}`}
            onClick={() => {
              onRemove(field);
            }}
          >
            {label}
            <XIcon weight="bold" aria-hidden />
          </button>
        );
      })}
      <button type="button" className="clear-filters" onClick={onClear}>
        Clear filters
      </button>
    </div>
  );
}
