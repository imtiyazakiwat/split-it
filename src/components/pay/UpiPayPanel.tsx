"use client";

import { UPI_APPS, UpiApp } from "@/lib/upi";
import { UpiAppIcon } from "@/components/UpiAppIcon";
import { List, RowButton, Section } from "@/components/kit/List";
import { IconTile } from "@/components/kit/Tile";
import { Icon } from "@/components/kit/Icon";

/**
 * The "actually move the money" half of a payment sheet: a row of UPI app
 * tiles (like the app row of a share sheet) and the payee's UPI ID to copy.
 * The app can only hand off — it never sees whether the payment went through
 * — so the copy route is always offered once a hand-off has been tried.
 */
export default function UpiPayPanel({
  toName,
  upiId,
  checked,
  usable,
  canHandOff,
  handedOff,
  onPay,
  onCopy,
}: {
  toName: string;
  upiId?: string;
  checked: boolean;
  usable: boolean;
  canHandOff: boolean;
  handedOff: boolean;
  onPay: (app: UpiApp) => void;
  onCopy: () => void;
}) {
  if (usable && upiId) {
    return (
      <Section
        header="Pay with UPI"
        footer={
          !canHandOff
            ? `UPI apps can only be opened from a phone. Copy ${toName}'s UPI ID and pay from your bank app.`
            : handedOff
            ? "Nothing opened? Copy the UPI ID and pay from your bank app."
            : "Opens your UPI app with the amount filled in. Come back here to record it."
        }
      >
        <div className="grid grid-cols-4 gap-2">
          {UPI_APPS.map((app) => (
            <button
              key={app.id}
              type="button"
              onClick={() => onPay(app)}
              className="flex flex-col items-center gap-1.5 rounded-[18px] bg-[var(--cell-elevated)] px-1 py-3 transition-transform duration-150 active:scale-95"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-[12px] bg-white shadow-[0_0_0_0.5px_rgba(0,0,0,0.08)]">
                <UpiAppIcon id={app.id} className="h-6 w-6" />
              </span>
              <span className="t-caption w-full truncate text-center text-label">{app.label}</span>
            </button>
          ))}
        </div>
        <List className="mt-3">
          <RowButton
            onClick={onCopy}
            leading={<IconTile icon="copy" color="var(--gray)" />}
            title="Copy UPI ID"
            value={upiId}
            ariaLabel={`Copy UPI ID ${upiId}`}
          />
        </List>
      </Section>
    );
  }
  if (upiId) {
    return (
      <Section>
        <div className="card flex items-start gap-3 p-4">
          <span className="text-[var(--orange)]">
            <Icon name="exclamationmark.triangle" size={20} />
          </span>
          <p className="t-footnote text-label-2">
            {toName}&rsquo;s saved UPI ID (<span className="font-medium text-label">{upiId}</span>) isn&rsquo;t a
            valid handle@bank address, so UPI apps can&rsquo;t open it. Ask them to fix it in Settings.
          </p>
        </div>
      </Section>
    );
  }
  return (
    <p className="section-footer mt-4">
      {checked
        ? `${toName} hasn't added a UPI ID. Pay them however you like — cash, UPI, bank transfer — and record it here.`
        : "Checking for a UPI ID…"}
    </p>
  );
}
