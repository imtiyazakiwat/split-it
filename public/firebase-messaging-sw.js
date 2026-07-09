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

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  const options = {
    body: notification.body || data.body || "",
    data,
  };
  if (notification.icon) options.icon = notification.icon;
  self.registration.showNotification(
    notification.title || data.title || "SplitIt",
    options
  );
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
