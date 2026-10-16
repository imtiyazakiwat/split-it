"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useToast } from "@/components/ui/Toast";
import { Sheet } from "@/components/kit/Sheet";
import { Button, Spinner } from "@/components/kit/Controls";

/** The join URL for a code, on whichever host the app is served from. */
function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

/**
 * Invite sheet: a scannable QR for sharing in person, plus the code and the
 * link for everything else.
 *
 * The QR is a PNG data URL in an <img>, not injected SVG markup, so nothing
 * from the library reaches the DOM as HTML. Generated at 2× display size so it
 * stays crisp — and scannable — on dense screens. Always on a white plate: a
 * dark-mode surface behind a dark QR does not scan.
 */
export default function InviteQrSheet({
  groupName,
  inviteCode,
  onClose,
}: {
  groupName: string;
  inviteCode: string;
  onClose: () => void;
}) {
  // Tagged with the code that produced it, so a rotated invite code
  // invalidates the previous QR by derivation rather than by clearing state.
  const [result, setResult] = useState<{ code: string; dataUrl?: string; failed?: boolean } | null>(null);
  const current = result?.code === inviteCode ? result : null;
  const dataUrl = current?.dataUrl ?? "";
  const failed = current?.failed ?? false;
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const showToast = useToast();

  useEffect(() => {
    const url = inviteLink(inviteCode);
    let cancelled = false;
    QRCode.toDataURL(url, {
      width: 512,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((png) => {
        if (!cancelled) setResult({ code: inviteCode, dataUrl: png });
      })
      .catch(() => {
        if (!cancelled) setResult({ code: inviteCode, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  async function copy(text: string, which: "link" | "code") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 2000);
  }

  async function share() {
    const link = inviteLink(inviteCode);
    const nav = navigator as Navigator & {
      share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>;
    };
    if (nav.share) {
      try {
        await nav.share({ title: groupName, text: `Join “${groupName}” on SplitIt`, url: link });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    await copy(link, "link");
    showToast({ message: "Link copied" });
  }

  return (
    <Sheet title="Invite People" subtitle={groupName} onClose={onClose}>
      <div className="flex flex-col items-center pt-2">
        <div className="rounded-[28px] bg-white p-4 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)]">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={dataUrl}
              alt={`QR code to join ${groupName}`}
              width={220}
              height={220}
              className="block h-[220px] w-[220px]"
            />
          ) : (
            <div className="grid h-[220px] w-[220px] place-items-center px-4 text-center text-neutral-500">
              {failed ? (
                <p className="t-footnote">Couldn&rsquo;t draw the QR code — use the code below.</p>
              ) : (
                <Spinner />
              )}
            </div>
          )}
        </div>
        <p className="t-footnote mt-3 text-center text-label-2">Scan with the iPhone or Android camera to join.</p>

        {/* The code itself, for anyone whose camera won't cooperate. */}
        <button
          type="button"
          onClick={() => copy(inviteCode, "code")}
          className="mt-4 flex w-full flex-col items-center rounded-[22px] bg-[var(--cell-elevated)] px-4 py-3 transition-transform duration-150 active:scale-[0.98]"
          aria-label={`Invite code ${inviteCode.split("").join(" ")}. Tap to copy`}
        >
          <span className="t-footnote text-label-2">{copied === "code" ? "Copied" : "Invite code · tap to copy"}</span>
          <span className="num mt-0.5 text-[28px] font-bold tracking-[0.24em]">{inviteCode}</span>
        </button>

        <div className="mt-4 grid w-full grid-cols-2 gap-2">
          <Button icon="share" onClick={share}>
            Share Link
          </Button>
          <Button variant="tinted" icon={copied === "link" ? "checkmark" : "link"} onClick={() => copy(inviteLink(inviteCode), "link")}>
            {copied === "link" ? "Copied" : "Copy Link"}
          </Button>
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {copied ? `${copied === "code" ? "Code" : "Link"} copied` : ""}
      </span>
    </Sheet>
  );
}
