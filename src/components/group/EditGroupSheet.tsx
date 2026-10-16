"use client";

import { useRef, useState } from "react";
import { Group } from "@/lib/types";
import { updateGroupProfile } from "@/lib/firestore";
import { uploadImage } from "@/lib/storage";
import { activateFileInputOnKey } from "@/lib/keyboard";
import { useToast } from "@/components/ui/Toast";
import { Sheet, SheetIconButton, type SheetHandle } from "@/components/kit/Sheet";
import { List, RowButton, Section } from "@/components/kit/List";
import { FieldRow, Switch } from "@/components/kit/Controls";
import { GroupAvatar } from "@/components/kit/Tile";

/**
 * Edit sheet for a group (admin only). Commit is the ✓ in the header,
 * disabled until there's a name; Delete lives at the bottom of this sheet,
 * behind a confirmation — the one place destructive group actions belong.
 *
 * Its form state lives here rather than in the group screen, so typing a name
 * re-renders this sheet and not the whole ledger behind it.
 */
export default function EditGroupSheet({
  group,
  onClose,
  onDelete,
}: {
  group: Group;
  onClose: () => void;
  /** Asks for confirmation and deletes; owned by the screen (it navigates away). */
  onDelete: () => void;
}) {
  const [name, setName] = useState(group.name);
  const [desc, setDesc] = useState(group.description || "");
  const [useSimplified, setUseSimplified] = useState(group.useSimplifiedDebts === true);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState(group.photoURL || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sheetRef = useRef<SheetHandle>(null);
  const showToast = useToast();

  const dirty =
    name !== group.name ||
    desc !== (group.description || "") ||
    useSimplified !== (group.useSimplifiedDebts === true) ||
    !!photoFile;

  function handlePhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function handleSave(e?: React.FormEvent) {
    e?.preventDefault();
    if (!name.trim()) {
      setError("Group name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      let photoURL = photoPreview || undefined;
      if (photoFile) {
        photoURL = await uploadImage(photoFile, "group-avatar");
      }
      await updateGroupProfile(group.id, {
        name: name.trim(),
        description: desc.trim() || undefined,
        photoURL,
        useSimplifiedDebts: useSimplified,
      });
      showToast({ message: "Group updated" });
      sheetRef.current?.dismiss();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update group");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      ref={sheetRef}
      large
      title="Edit Group"
      dirty={dirty && !busy}
      onClose={onClose}
      trailing={
        <SheetIconButton
          icon="checkmark"
          label="Save group"
          prominent
          disabled={!name.trim() || busy}
          onClick={() => void handleSave()}
        />
      }
    >
      <form onSubmit={handleSave}>
        <div className="flex flex-col items-center pb-2 pt-3">
          <label
            role="button"
            tabIndex={0}
            aria-label="Change group photo"
            onKeyDown={activateFileInputOnKey}
            className="relative cursor-pointer"
          >
            <GroupAvatar id={group.id} name={name || group.name} photoURL={photoPreview} size={96} />
            <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
            <span className="t-subhead mt-2 block text-center font-medium text-tint">
              {photoPreview ? "Change Photo" : "Add Photo"}
            </span>
          </label>
        </div>

        <Section tight>
          <List>
            <FieldRow
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Group name"
              aria-label="Group name"
              maxLength={60}
            />
            <FieldRow
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Description (optional)"
              aria-label="Description"
              maxLength={140}
            />
          </List>
        </Section>

        <Section
          footer={
            <>
              Off: everyone settles directly with each person they shared expenses with. On: the app
              reshuffles who pays whom for fewer transfers — which can ask you to pay someone you
              never shared a bill with.
            </>
          }
        >
          <List>
            <div className="row">
              <span className="row-main">
                <span className="row-title">Combine Payments</span>
              </span>
              <Switch checked={useSimplified} onChange={setUseSimplified} label="Combine payments" />
            </div>
          </List>
        </Section>

        {error && <p className="t-footnote mt-3 px-4 text-neg">{error}</p>}

        <Section footer="Permanently removes this group and its balances for everyone. This can't be undone.">
          <List>
            <RowButton onClick={onDelete} title="Delete Group" destructive centered disabled={busy} />
          </List>
        </Section>
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Sheet>
  );
}
