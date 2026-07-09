import { NextRequest, NextResponse } from "next/server";

/**
 * Receives the multipart/form-data POST from the OS share sheet
 * (registered via `share_target` in app/manifest.ts). The actual file
 * capture happens in the service worker (public/sw.js), which intercepts
 * this same POST, stores the file in Cache Storage, then lets this
 * request fall through so the browser navigates to /share-receipt.
 *
 * This route is a fallback for browsers where the service worker hasn't
 * activated yet — in that case we just redirect and the user selects the
 * image manually on the share-receipt page.
 */
export async function POST(request: NextRequest) {
  return NextResponse.redirect(new URL("/share-receipt", request.url), 303);
}
