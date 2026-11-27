/**
 * @file Choosing the order of the views in the rail: drag a view by its handle, or move
 * it a place up or down; *Reset order* goes back to the default. Kept per browser.
 */

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownIcon, ArrowUpIcon, DotsSixVerticalIcon } from "@phosphor-icons/react";

import {
  DEFAULT_RAIL_ORDER,
  type RailView,
  moved,
  resetRailOrder,
  setRailOrder,
  useRailOrder,
} from "../railOrder";
import { RAIL_ENTRIES, railAnnouncements } from "./railViews";
import { useWords } from "../locale";

const MODIFIERS = [restrictToVerticalAxis, restrictToParentElement];

/** The rail's views in this browser's order, each movable, and a way back to the default. */
export function RailOrderSettings() {
  const t = useWords();
  const order = useRailOrder();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const drop = ({ active, over }: DragEndEvent) => {
    const from = order.indexOf(active.id as RailView);
    const to = over === null ? -1 : order.indexOf(over.id as RailView);
    if (from >= 0 && to >= 0 && from !== to) {
      setRailOrder(arrayMove([...order], from, to));
    }
  };
  const isDefault = order.every((view, index) => view === DEFAULT_RAIL_ORDER[index]);
  return (
    <div className="rail-order">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={MODIFIERS}
        accessibility={{
          screenReaderInstructions: {
            draggable: t(
              "Press Space to pick up a view, use the arrow keys to move it, and press Space to drop it. Press Escape to cancel.",
            ),
          },
          announcements: railAnnouncements(order, t),
        }}
        onDragEnd={drop}
      >
        <SortableContext items={[...order]} strategy={verticalListSortingStrategy}>
          <ol className="rail-order-list" aria-label={t("Views in the rail")}>
            {order.map((view, index) => (
              <RailOrderRow
                key={view}
                view={view}
                first={index === 0}
                last={index === order.length - 1}
                onMove={(by) => {
                  setRailOrder(moved(order, view, by));
                }}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      <button type="button" className="secondary" disabled={isDefault} onClick={resetRailOrder}>
        {t("Reset order")}
      </button>
    </div>
  );
}

/** One view: a handle to drag it, its icon and name, and buttons to move it a place. */
function RailOrderRow({
  view,
  first,
  last,
  onMove,
}: {
  readonly view: RailView;
  readonly first: boolean;
  readonly last: boolean;
  readonly onMove: (by: -1 | 1) => void;
}) {
  const t = useWords();
  const { label, icon: ViewIcon } = RAIL_ENTRIES[view];
  const name = t(label);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: view });
  return (
    <li
      ref={setNodeRef}
      data-view={view}
      className={isDragging ? "rail-order-row dragging" : "rail-order-row"}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        type="button"
        className="icon rail-order-handle"
        ref={setActivatorNodeRef}
        aria-label={t("Reorder {{view}}", { view: name })}
        title={t("Drag to reorder")}
        {...attributes}
        {...listeners}
        aria-roledescription={t("sortable")}
        data-sortable-handle=""
      >
        <DotsSixVerticalIcon weight="bold" aria-hidden />
      </button>
      <ViewIcon aria-hidden />
      <span className="rail-order-name">{name}</span>
      <button
        type="button"
        className="icon"
        aria-label={t("Move {{view}} up", { view: name })}
        title={t("Move up")}
        disabled={first}
        onClick={() => {
          onMove(-1);
        }}
      >
        <ArrowUpIcon aria-hidden />
      </button>
      <button
        type="button"
        className="icon"
        aria-label={t("Move {{view}} down", { view: name })}
        title={t("Move down")}
        disabled={last}
        onClick={() => {
          onMove(1);
        }}
      >
        <ArrowDownIcon aria-hidden />
      </button>
    </li>
  );
}
