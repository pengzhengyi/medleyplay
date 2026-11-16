/**
 * @file The panel under the search box: the artists a search names, each to show, its
 * songs, or its albums, and grouping the Library by artist; or, in an empty box, the
 * tags a search can use. Its options are chosen from the box, as a combobox's are.
 */

import type { ReactNode } from "react";

import type { Field } from "../library/query";
import type { Route } from "../routes";

/** One choice the panel offers, as the box moves through them. */
export interface PanelOption {
  readonly key: string;
  /** The artist it belongs to, whose row it sits in, if any. */
  readonly row?: string;
  readonly content: ReactNode;
  readonly className: string;
  readonly title?: string;
  /** What choosing it does: show a view, start a tag in the box, or search a site. */
  readonly does: { readonly go: Route } | { readonly tag: Field } | { readonly site: string };
}

/**
 * The options as a listbox named `label`, `active` the one the box points at. The
 * panel keeps the box's focus when pressed, so typing goes on.
 */
export function SearchPanel({
  id,
  label,
  options,
  active,
  rows,
  onChoose,
}: {
  readonly id: string;
  readonly label: string;
  readonly options: readonly PanelOption[];
  readonly active: number;
  /** Called with the option chosen by pointer. */
  readonly onChoose: (option: PanelOption) => void;
  /** The rows the options of an artist sit in, by name, each with what says who it is. */
  readonly rows?: ReadonlyMap<string, string>;
}) {
  const optionAt = (option: PanelOption, at: number) => (
    <div
      key={option.key}
      id={`${id}-${String(at)}`}
      role="option"
      aria-selected={at === active}
      className={option.className}
      title={option.title}
      onClick={() => {
        onChoose(option);
      }}
    >
      {option.content}
    </div>
  );
  const shown: ReactNode[] = [];
  options.forEach((option, at) => {
    const row = option.row;
    if (row === undefined) {
      shown.push(optionAt(option, at));
      return;
    }
    if (options[at - 1]?.row === row) {
      return;
    }
    const members = options
      .map((each, index) => ({ each, index }))
      .filter(({ each }) => each.row === row);
    shown.push(
      <div
        key={`row-${row}`}
        role="group"
        aria-label={rows?.get(row) ?? row}
        className="suggest-row"
      >
        {members.map(({ each, index }) => optionAt(each, index))}
      </div>,
    );
  });
  return (
    <div
      id={id}
      role="listbox"
      aria-label={label}
      className="search-panel"
      // Pressed anywhere, the panel keeps the box's focus, so a near miss doesn't close it.
      onMouseDown={(event) => {
        event.preventDefault();
      }}
    >
      {shown}
    </div>
  );
}
