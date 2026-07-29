"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import GlassModal from "@/components/ui/GlassModal";
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
    <GlassModal title="Invite to this group" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-[14px] text-[var(--text-secondary)]">
          Have them scan this, or send them the link. They&rsquo;ll join{" "}
          <span className="font-semibold text-[var(--text-primary)]">{groupName}</span>.
        </p>

        {/* White plate regardless of theme: QR contrast has to be fixed, and a
            dark-mode surface behind a dark QR does not scan. */}
        <div className="flex justify-center">
          <div className="rounded-[var(--radius-inner)] bg-white p-3 shadow-[var(--shadow-card)]">
            {dataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={dataUrl}
                alt={`QR code to join ${groupName}`}
                width={232}
                height={232}
                className="block w-[232px] h-[232px]"
              />
            ) : (
              <div className="w-[232px] h-[232px] grid place-items-center text-center px-4">
                <p className="text-[13px] text-neutral-500">
                  {failed ? "Couldn’t draw the QR code — use the code below." : "Generating…"}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* The code itself, for anyone whose camera won't cooperate. */}
        <button
          type="button"
          onClick={() => copy(inviteCode, "code")}
          className="w-full rounded-[var(--radius-inner)] bg-[var(--fill-soft)] px-4 py-3 tap-shrink"
        >
          <span className="block text-[11px] font-semibold tracking-wide text-[var(--text-tertiary)]">
            INVITE CODE {copied === "code" ? "· COPIED" : "· TAP TO COPY"}
          </span>
          <span className="block text-[26px] font-extrabold tracking-[0.2em] text-[var(--text-primary)] mt-0.5">
            {inviteCode}
          </span>
        </button>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={share}
            className="flex-1 rounded-full bg-[var(--brand-solid)] text-white px-4 py-3 text-[15px] font-semibold tap-shrink"
          >
            Share link
          </button>
          <button
            type="button"
            onClick={() => copy(inviteLink(inviteCode), "link")}
            className="flex-1 rounded-full bg-[var(--surface)] border border-[var(--border-subtle)] px-4 py-3 text-[15px] font-semibold text-[var(--text-primary)] tap-shrink"
          >
            {copied === "link" ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>
    </GlassModal>
  );
}
