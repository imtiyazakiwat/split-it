"use client";

import { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";

interface GlassFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function GlassField({ label, className = "", ...props }: GlassFieldProps) {
  return (
    <label className="block text-sm font-medium text-[var(--label-secondary)]">
      {label}
      <input
        className={`mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] placeholder:text-[var(--label-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition ${className}`}
        {...props}
      />
    </label>
  );
}

interface GlassSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
  children: ReactNode;
}

export function GlassSelect({ label, children, className = "", ...props }: GlassSelectProps) {
  return (
    <label className="block text-sm font-medium text-[var(--label-secondary)]">
      {label}
      <select
        className={`mt-1.5 w-full rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface)] px-3.5 py-2.5 text-[15px] text-[var(--label-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition ${className}`}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}
