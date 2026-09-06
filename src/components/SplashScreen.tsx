import Logo from "@/components/Logo";

/**
 * Full-screen animated brand splash. The "split it" wordmark pops in with a
 * shimmer sweep, over a soft indigo-tinted backdrop, with a small loader.
 */
export default function SplashScreen() {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-b from-white to-indigo-50 dark:from-black dark:to-indigo-950">
      <div className="relative animate-splash-logo">
        <Logo className="h-16 w-auto" />
        {/* shimmer sweep clipped to the logo area */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="animate-splash-shimmer absolute top-0 -left-1/3 h-full w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent" />
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-8">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-2 h-2 rounded-full bg-indigo-500 dark:bg-indigo-400 animate-splash-dot"
            style={{ animationDelay: `${i * 0.16}s` }}
          />
        ))}
      </div>
    </div>
  );
}
