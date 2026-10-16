"use client";

import type { ReactNode } from "react";

/**
 * The amount, set large and centred, the way Apple Cash takes a number: the
 * field is exactly as wide as what's typed, so the ₹ stays tight to the figure
 * instead of floating at the left of a full-width box.
 *
 * Sizing comes from an invisible in-flow mirror of the value; the real input
 * is laid absolutely over it. (Inside a grid or flex track the input's own
 * intrinsic width — roughly 20 characters — would win and stretch the field.)
 * Long figures step the type down so ₹1,00,00,000 still fits on one line.
 */
export function AmountField({
  id,
  value,
  onChange,
  autoFocus,
  label = "Amount in rupees",
  size = 56,
  caption,
  tone,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
  label?: string;
  size?: number;
  caption?: ReactNode;
  tone?: "pos" | "neg";
}) {
  const color = tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-label";
  const len = value.length;
  const fs = len > 9 ? Math.round(size * 0.62) : len > 7 ? Math.round(size * 0.76) : len > 5 ? Math.round(size * 0.88) : size;
  return (
    <div className="flex flex-col items-center pb-3 pt-4">
      <label className={`flex max-w-full items-baseline justify-center gap-1 ${color}`} htmlFor={id}>
        <span className="amount-hero text-label-2" style={{ fontSize: Math.round(fs * 0.6) }}>
          ₹
        </span>
        <span className="relative inline-block min-w-0">
          <span
            aria-hidden
            className="amount-hero invisible block whitespace-pre px-1"
            style={{ fontSize: fs }}
          >
            {value || "0"}
          </span>
          <input
            id={id}
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            autoFocus={autoFocus}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="0"
            aria-label={label}
            className="amount-hero absolute inset-0 w-full min-w-0 bg-transparent px-1 text-center outline-none placeholder:text-[var(--label-4)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ fontSize: fs, color: "inherit" }}
          />
        </span>
      </label>
      {caption && <div className="t-footnote mt-1 px-4 text-center text-label-2">{caption}</div>}
    </div>
  );
}
