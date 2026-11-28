/** @file Input sensors for dragging rows in a scrollable list. */

import { KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors } from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";

class NonTouchPointerSensor extends PointerSensor {
  static override activators: typeof PointerSensor.activators = PointerSensor.activators.map(
    ({ eventName, handler }) => ({
      eventName,
      handler: (event, options) =>
        event.nativeEvent.pointerType !== "touch" && handler(event, options),
    }),
  );
}

/** A finger can scroll from the handle or hold it for 300 ms to start dragging. */
export function useReorderSensors() {
  return useSensors(
    useSensor(NonTouchPointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
