import Image from "next/image";

/**
 * The first web frame. It reproduces the static apple-touch-startup-image —
 * the blue gradient, the app icon, the name — so the launch screen iOS shows
 * before any JavaScript runs continues seamlessly into the app instead of
 * cutting to a different design. No spinner: this is shown for a few hundred
 * milliseconds while a cached session resolves, not while anything loads.
 */
export default function SplashScreen({ leaving = false }: { leaving?: boolean }) {
  return (
    <div className={`splash ${leaving ? "is-leaving" : ""}`}>
      <Image
        src="/icon-512.png"
        alt=""
        width={86}
        height={86}
        priority
        className="splash-icon"
      />
      <p className="splash-name">SplitIt</p>
    </div>
  );
}
