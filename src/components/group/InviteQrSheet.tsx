"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import GlassModal from "@/components/ui/GlassModal";
import { ButtonRow, ListSection } from "@/components/ui/List";
import { Copy, Share } from "@/components/ui/Icons";
import { useToast } from "@/components/ui/Toast";

/** The join URL for a code, on whichever host the app is served from. */
function inviteLink(code: string): string {
  return `${window.location.origin}/join/${code}`;
}

/**
 * Invite sheet: a scannable QR code for sharing a group in person, plus the
 * raw code and link for everything else.
 *
 * The QR is rendered as a PNG data URL and drawn into an <img> rather than
 * injected as inline SVG markup, so nothing from the library reaches the DOM as
 * HTML. It is generated at 2x the display size to stay crisp — and scannable —
 * on high-density screens.
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
  // The result is tagged with the code that produced it, so a rotated invite
  // code invalidates the previous QR by derivation rather than by clearing state
  // in the effect. Clearing it there would leave the old code's QR (or a stale
  // failure message) on screen for a render, and would show the wrong code
  // entirely if generation for the new one failed.
  const [result, setResult] = useState<{
    code: string;
    dataUrl?: string;
    failed?: boolean;
  } | null>(null);
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
        await nav.share({
          title: groupName,
          text: `Join “${groupName}” on split it`,
          url: link,
        });
        return;
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    }
    await copy(link, "link");
    showToast({ message: "Link copied" });
  }

  return (
    <GlassModal title="Invite People" onClose={onClose}>
      <p className="t-subhead text-[var(--text-secondary)] text-center px-6 pt-1">
        Have them scan this code with their camera, or send them the link to join{" "}
        <span className="font-semibold text-[var(--text-primary)]">{groupName}</span>.
      </p>

      {/* White plate regardless of theme: a dark QR on a dark surface won't scan. */}
      <div className="flex justify-center mt-5">
        <div className="rounded-[24px] bg-white p-3.5 shadow-[0_0_0_0.5px_var(--separator)]">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt={`QR code to join ${groupName}`} width={220} height={220} className="block w-[220px] h-[220px]" />
          ) : (
            <div className="w-[220px] h-[220px] grid place-items-center text-center px-4">
              <p className="text-[13px] text-neutral-500">
                {failed ? "Couldn’t draw the QR code. Use the code below." : "Generating…"}
              </p>
            </div>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => copy(inviteCode, "code")}
        className="w-full flex flex-col items-center mt-4 py-2 tap-shrink"
        aria-label={`Invite code ${inviteCode}. Tap to copy.`}
      >
        <span className="text-[28px] font-bold tracking-[0.22em] t-numeral text-[var(--text-primary)] selectable">{inviteCode}</span>
        <span className="t-footnote text-[var(--text-secondary)]">{copied === "code" ? "Copied" : "Invite Code · Tap to Copy"}</span>
      </button>

      <ListSection elevated>
        <ButtonRow onClick={share} leading={<span className="text-[var(--brand)]"><Share size={20} /></span>} title="Share Invite Link" action />
        <ButtonRow
          onClick={() => copy(inviteLink(inviteCode), "link")}
          leading={<span className="text-[var(--brand)]"><Copy size={19} /></span>}
          title={copied === "link" ? "Copied" : "Copy Link"}
          action
        />
      </ListSection>
    </GlassModal>
  );
}
