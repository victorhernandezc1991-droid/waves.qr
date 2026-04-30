// ─── Service Worker de Firebase Cloud Messaging ──────────────────────────────
// Este archivo lo registra getToken() automáticamente en /firebase-messaging-sw.js.
// Maneja mensajes push cuando la app está cerrada o en background.
//
// IMPORTANTE: este archivo NO puede usar import.meta.env (no es un módulo de Vite).
// La config se inyecta vía URL params en runtime — ver registrarFCMToken().

importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js");

// Config Firebase del proyecto Waves (los Web SDK keys son públicos por diseño,
// la seguridad real está en las Firestore Rules y en el VAPID key del FCM).
firebase.initializeApp({
  apiKey: "AIzaSyASpLhGwZjUy_I-82CyXYVW1U3uwcTAUKQ",
  authDomain: "waves-qr1.firebaseapp.com",
  projectId: "waves-qr1",
  storageBucket: "waves-qr1.firebasestorage.app",
  messagingSenderId: "67955398448",
  appId: "1:67955398448:web:d535c7466d65a5695d1af5",
});

const messaging = firebase.messaging();

// Background handler: la notificación se muestra automáticamente si el payload
// trae un campo `notification`. Acá podemos personalizar / agregar acciones.
messaging.onBackgroundMessage(payload => {
  const title = payload.notification?.title || "Nuevo pedido";
  const opts = {
    body: payload.notification?.body || "",
    icon: payload.notification?.icon || "/logo-waves.png",
    badge: "/logo-waves.png",
    tag: "waves-pedido",
    requireInteraction: false,
    data: payload.data || {},
  };
  self.registration.showNotification(title, opts);
});

// Click en la notificación → abrir/enfocar la app en /waves (o ruta del data)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/waves";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      const open = list.find(c => c.url.includes(url));
      if (open) return open.focus();
      return clients.openWindow(url);
    })
  );
});
