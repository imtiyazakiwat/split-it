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

export async function uploadImage(
  file: File,
  _context: string
): Promise<string> {
  return uploadToImgBB(file, file.name);
}
