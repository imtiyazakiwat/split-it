"use client";

import { usePathname } from "next/navigation";
import { ReactNode } from "react";

/**
 * Plays a subtle fade/rise on the routed content whenever the path changes,
 * replacing the hard cut between screens. Keying the wrapper by pathname
 * restarts the CSS animation on each navigation. Respects reduced-motion (the
 * .page-enter animation is disabled in that media query).
 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter flex-1 flex flex-col min-h-full">
      {children}
    </div>
  );
}
