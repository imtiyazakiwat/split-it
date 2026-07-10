/**
 * Shaped loading placeholder. Size/shape via className (e.g. "h-4 w-24").
 */
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden />;
}
