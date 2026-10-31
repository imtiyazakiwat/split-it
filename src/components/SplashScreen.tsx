import Image from "next/image";

/**
 * Launch screen. Apple's guidance: show the app's first frame, not a branded
 * animation, so launch feels instant. The icon fades in on the system
 * background and the screen dissolves once auth resolves.
 */
export default function SplashScreen() {
  return (
    <div className="w-full h-full flex items-center justify-center bg-[var(--background)]">
      <div className="animate-splash-logo w-[96px] h-[96px] rounded-[24px] overflow-hidden shadow-[0_8px_24px_rgba(0,0,0,0.12)]">
        <Image src="/icon-512.png" alt="SplitIt" width={96} height={96} priority className="w-full h-full" />
      </div>
    </div>
  );
}
