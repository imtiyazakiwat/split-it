/**
 * Image uploads go to Firebase Storage (the project's default bucket).
 *
 * ImgBB used to host them. Its links failed intermittently (HTTP 503 with an
 * "image not found" placeholder) and some files vanished, which is how
 * profile photos broke. scripts/migrate-imgbb-to-storage.mjs moved every
 * existing image across; this module handles new ones.
 *
 * Layout (enforced by storage.rules): {folder}/{uploaderUid}/{random}.{ext}.
 * Only the signed-in uploader can write under their uid, objects are
 * images under 10 MB, and they are readable by anyone holding the download
 * URL, the same exposure an ImgBB link had.
 *
 * The SDK is imported lazily so it never lands on the cold-start path.
 */

type Folder = "avatars" | "groups" | "receipts";

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

async function uploadToStorage(blob: Blob, folder: Folder): Promise<string> {
  const [{ getStorage, ref, uploadBytes, getDownloadURL }, { app, auth }] = await Promise.all([
    import("firebase/storage"),
    import("./firebase"),
  ]);
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error("Sign in again to upload images.");
  const type = blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg";
  const name = `${folder}/${uid}/${crypto.randomUUID()}.${EXT[type] || "jpg"}`;
  const objectRef = ref(getStorage(app), name);
  try {
    await uploadBytes(objectRef, blob, {
      contentType: type,
      cacheControl: "public, max-age=31536000, immutable",
    });
  } catch (err) {
    const code = (err as { code?: string })?.code || "";
    if (code === "storage/unauthorized") {
      throw new Error("That file can’t be uploaded. Use an image under 10 MB.");
    }
    if (code === "storage/retry-limit-exceeded" || code === "storage/canceled") {
      throw new Error("The upload didn’t finish. Check your connection and try again.");
    }
    throw new Error("Couldn’t upload the image. Try again.");
  }
  return getDownloadURL(objectRef);
}

/**
 * Downscales a photo in the browser before upload. A phone camera photo is
 * 3–8 MB; shown in a 44 pt circle it was the slowest thing on the screen.
 * Avatars and group photos never render above ~96 pt, so 512 px is plenty
 * even at 3x; receipts keep enough detail to read (2048 px). Falls back to
 * the original on any failure.
 */
async function downscale(file: File, maxEdge: number): Promise<Blob> {
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

export async function uploadReceipt(_groupId: string, file: File): Promise<string> {
  return uploadToStorage(await downscale(file, 2048), "receipts");
}

export async function uploadMultipleReceipts(groupId: string, files: File[]): Promise<string[]> {
  return Promise.all(files.map((f) => uploadReceipt(groupId, f)));
}

/** Profile photos, group photos and transfer screenshots. */
export async function uploadImage(file: File, context: string): Promise<string> {
  if (context === "avatar") return uploadToStorage(await downscale(file, 512), "avatars");
  if (context === "group-avatar") return uploadToStorage(await downscale(file, 512), "groups");
  return uploadToStorage(await downscale(file, 2048), "receipts");
}
