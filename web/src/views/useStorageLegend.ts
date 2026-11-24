/** @file Highlights a storage slice while its legend entry is hovered or focused. */

import { useState } from "react";

export function useStorageLegend<Key extends string>() {
  const [hovered, setHovered] = useState<Key>();
  const [focused, setFocused] = useState<Key>();
  const active = hovered ?? focused;
  return {
    active,
    entry: (key: Key) => ({
      onPointerEnter: () => {
        setHovered(key);
      },
      onPointerLeave: () => {
        setHovered(undefined);
      },
      onFocus: () => {
        setFocused(key);
      },
      onBlur: () => {
        setFocused(undefined);
      },
    }),
    clear: () => {
      setHovered(undefined);
      setFocused(undefined);
    },
  };
}
