import type { Ref, RefCallback } from "react";

export function composeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref !== undefined && ref !== null) {
        ref.current = node;
      }
    }
  };
}
