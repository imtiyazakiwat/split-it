importScripts(
  "https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js"
);
importScripts(
  "https://www.gstatic.com/firebasejs/12.13.0/firebase-messaging-compat.js"
);

// Config is passed via query params at registration time
// so this file stays generic and env vars stay the source of truth.
const params = new URLSearchParams(self.location.search);

firebase.initializeApp({
  apiKey: params.get("apiKey") || "",
  authDomain: params.get("authDomain") || "",
  projectId: params.get("projectId") || "",
  storageBucket: params.get("storageBucket") || "",
  messagingSenderId: params.get("messagingSenderId") || "",
  appId: params.get("appId") || "",
});

const messaging = firebase.messaging();

// The server sends data-only messages on purpose: a payload carrying a
// `notification` block is rendered by FCM itself *and* delivered here, which
// showed every push twice. This handler is the only renderer, so it owns the
// icon, the tag and the click target.
//
// `payload.notification` is still read first so a stale client that receives an
// older-style message keeps working.
messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const title = notification.title || data.title || "split it";
  const options = {
    body: notification.body || data.body || "",
    icon: notification.icon || "/icon-192.png",
    badge: "/favicon-32.png",
    data: data,
  };
  // Repeats of the same message replace each other instead of stacking up.
  if (data.tag) options.tag = data.tag;
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target =
    (event.notification.data && event.notification.data.link) ||
    (event.notification.data && event.notification.data.url) ||
    "/";
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const client of wins) {
          if ("focus" in client) {
            client.navigate(target);
            return client.focus();
          }
        }
        if (clients.openWindow) return clients.openWindow(target);
      })
  );
});
