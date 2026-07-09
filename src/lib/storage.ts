/**
 * Uploads a receipt image to ImgBB (https://api.imgbb.com) and returns the
 * public URL. Used instead of Firebase Storage since receipts are just
 * images shared between a trusted small group — no auth-scoped access
 * control on the image itself, so don't rely on this for sensitive data.
 */
export async function uploadReceipt(
  _groupId: string,
  file: File | Blob,
  _filename?: string
): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_IMGBB_API_KEY;
  if (!apiKey) {
    throw new Error(
      "NEXT_PUBLIC_IMGBB_API_KEY is not set. Add it to .env.local to enable receipt uploads."
    );
  }

  const formData = new FormData();
  formData.append("image", file);

  const res = await fetch(`https://api.imgbb.com/1/upload?key=${apiKey}`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`ImgBB upload failed: ${res.status}`);
  }

  const data = await res.json();
  if (!data?.data?.url) {
    throw new Error("ImgBB upload succeeded but no URL was returned.");
  }

  return data.data.url as string;
}
