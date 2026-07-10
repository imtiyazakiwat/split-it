/**
 * The "split it" wordmark. Replaces the plain "S" mark. Sized via className
 * (defaults to a header-friendly height); the 720×180 viewBox keeps the 4:1
 * aspect ratio.
 */
export default function Logo({ className = "h-8 w-auto" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 720 180"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="split it"
    >
      <defs>
        <linearGradient id="splitGradient" x1="0" y1="0" x2="720" y2="180" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#5A4DFF" />
          <stop offset="100%" stopColor="#4338F2" />
        </linearGradient>
      </defs>
      <text
        x="20"
        y="130"
        fontFamily="SF Pro Display, Inter, Poppins, Helvetica, Arial, sans-serif"
        fontSize="128"
        fontWeight="900"
        letterSpacing="-5"
        fill="url(#splitGradient)"
      >
        split it
      </text>
    </svg>
  );
}
