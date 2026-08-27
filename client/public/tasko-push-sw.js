self.addEventListener("push", event => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(self.registration.showNotification(payload.title || "Tasko", {
    body: payload.body || "Bạn có một reminder mới.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    data: { href: payload.href || "/chat#saved" },
    tag: payload.tag || "tasko-reminder",
    renotify: true,
  }));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => "focus" in client);
    if (existing) { existing.focus(); return existing.navigate(event.notification.data.href); }
    return clients.openWindow(event.notification.data.href);
  }));
});
