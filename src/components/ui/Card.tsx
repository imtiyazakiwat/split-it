import { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
}

/**
 * Plain content surface (list rows, cards). Per iOS 26 guidance, Liquid
 * Glass is reserved for the floating navigation layer — content surfaces
 * use a solid/opaque background so the glass chrome above reads clearly.
 */
export default function Card({ children, interactive, className = "", ...props }: CardProps) {
  return (
    <div
      className={`bg-[var(--surface)] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] ${
        interactive ? "tap-shrink cursor-pointer" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}
