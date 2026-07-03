import { Slot } from "@radix-ui/react-slot";
import {
  type ComponentPropsWithoutRef,
  type ComponentPropsWithRef,
  createElement,
  type ElementType,
  type ReactElement,
  type Ref,
} from "react";

export type PrimitiveProps<TElement extends ElementType = "div"> = Omit<
  ComponentPropsWithoutRef<TElement>,
  "asChild"
> & {
  asChild?: boolean;
};

export type PrimitiveRef<TElement extends ElementType> = ComponentPropsWithRef<TElement>["ref"];

export function renderPrimitive<TElement extends ElementType>(
  element: TElement,
  props: PrimitiveProps<TElement>,
  ref?: Ref<unknown>,
): ReactElement {
  const { asChild, ...rest } = props;
  const Component = asChild ? Slot : element;
  const nextProps = ref === undefined ? rest : { ...rest, ref };
  return createElement(Component, nextProps);
}
