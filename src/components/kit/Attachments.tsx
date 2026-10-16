"use client";

import { useEffect, useMemo } from "react";
import { activateFileInputOnKey } from "@/lib/keyboard";
import { List, sepInset } from "./List";
import { IconTile } from "./Tile";
import { Icon } from "./Icon";

/** Object URLs for picked images, revoked when the list changes or unmounts. */
function usePreviews(files: File[]) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

/**
 * "Attach a photo" row plus thumbnails of what's been picked, each removable.
 * The file input lives inside the row's label, so the row itself is the
 * picker (and Enter/Space open it from the keyboard).
 */
export function Attachments({
  files,
  onChange,
  label,
  addMoreLabel = "Add Another",
  footer,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  label: string;
  addMoreLabel?: string;
  footer?: string;
}) {
  const previews = usePreviews(files);
  return (
    <>
      <List>
        <label
          role="button"
          tabIndex={0}
          aria-label={files.length ? addMoreLabel : label}
          onKeyDown={activateFileInputOnKey}
          className="row is-pressable"
          style={sepInset(58)}
        >
          <IconTile icon="camera" color="var(--blue)" />
          <span className="row-main">
            <span className="row-title text-tint">{files.length ? addMoreLabel : label}</span>
          </span>
          {files.length > 0 && <span className="row-value">{files.length}</span>}
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const picked = Array.from(e.target.files || []);
              e.target.value = "";
              onChange([...files, ...picked]);
            }}
          />
        </label>
      </List>
      {files.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2.5 px-1">
          {files.map((f, i) => (
            <span key={previews[i] ?? i} className="relative h-[72px] w-[72px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previews[i]} alt={f.name} className="h-full w-full rounded-[14px] bg-[var(--fill-3)] object-cover" />
              <button
                type="button"
                onClick={() => onChange(files.filter((_, j) => j !== i))}
                aria-label={`Remove ${f.name}`}
                className="absolute -right-2 -top-2 inline-flex h-8 w-8 items-center justify-center"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--label-2)] text-[var(--bg-elevated)] shadow">
                  <Icon name="xmark" size={12} strokeWidth={3} />
                </span>
              </button>
            </span>
          ))}
        </div>
      )}
      {footer && <p className="section-footer">{footer}</p>}
    </>
  );
}
