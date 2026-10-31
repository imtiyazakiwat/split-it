// Retired. The app registers /sw.js only, which now handles push itself.
//
// This file used to be a second service worker registered at the same scope as
// /sw.js. A scope holds one registration, so the two kept replacing each other,
// and whenever /sw.js was active — every launch — pushes had no handler and
// never appeared.
//
// It is kept as a thin shim, not deleted, because a phone still running an old
// cached bundle may try to register this URL once more before it picks up the
// new code. Importing the real worker means that registration gets the same
// handlers instead of a 404 or the old push-only worker.
importScripts("/sw.js");
