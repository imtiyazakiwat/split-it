import { ButtonHTMLAttributes, ReactNode } from "react";

interface GlassButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "primary" | "glass" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
}

const sizeClasses: Record<string, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-5 py-2.5 text-sm",
  lg: "px-6 py-3.5 text-base",
};

const variantClasses: Record<string, string> = {
  primary:
    "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_4px_16px_-4px_var(--accent)]",
  glass: "glass text-[var(--label-primary)]",
  ghost: "bg-transparent text-[var(--accent)]",
  danger: "bg-[var(--danger)] text-white shadow-[0_4px_16px_-4px_var(--danger)]",
};

export default function GlassButton({
  children,
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: GlassButtonProps) {
  return (
    <button
      className={`relative overflow-hidden rounded-full font-medium tap-shrink disabled:opacity-40 disabled:pointer-events-none ${sizeClasses[size]} ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {variant === "glass" && <span className="glass-specular" aria-hidden />}
      <span className="relative z-[1] flex items-center justify-center gap-2">{children}</span>
    </button>
  );
}
