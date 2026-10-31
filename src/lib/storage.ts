async function uploadToImgBB(file: File | Blob, _filename?: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_IMGBB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEXT_PUBLIC_IMGBB_API_KEY is not set. Add it to .env.local to enable image uploads."
    );
  }
  const formData = new FormData();
  formData.append("image", file);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(`ImgBB upload failed: ${res.status}`);
  const data = await res.json();
  if (!data?.data?.url) throw new Error("ImgBB upload succeeded but no URL was returned.");
  return data.data.url as string;
}

export async function uploadReceipt(
  _groupId: string,
  file: File | Blob,
  _filename?: string
): Promise<string> {
  return uploadToImgBB(file, _filename);
}

export async function uploadMultipleReceipts(
  groupId: string,
  files: File[]
): Promise<string[]> {
  const urls = await Promise.all(files.map((f) => uploadReceipt(groupId, f, f.name)));
  return urls;
}

/**
 * Downscales a photo in the browser before upload. A phone camera photo is
 * 3–8 MB; shown in a 44 pt circle it was the slowest thing on the screen, and
 * a busy image host times out on files that size, which is when avatars fell
 * back to initials. Avatars and group photos never render above ~96 pt, so
 * 512 px is plenty even at 3x. Falls back to the original on any failure.
 */
async function downscale(file: File, maxEdge = 512): Promise<Blob> {
  if (typeof window === "undefined" || !file.type.startsWith("image/")) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 400_000) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}

/** Profile and group photos: resized first, so they load fast everywhere. */
export async function uploadImage(file: File, context: string): Promise<string> {
  const isAvatar = context === "avatar" || context === "group-avatar";
  return uploadToImgBB(isAvatar ? await downscale(file) : file, file.name);
}
