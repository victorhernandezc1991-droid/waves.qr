// ─── Firebase Cloud Messaging — registro y manejo del token ──────────────────
import { getToken, onMessage } from "firebase/messaging";
import { doc, setDoc, deleteDoc, serverTimestamp } from "firebase/firestore";
import { db, getMessagingInstance, VAPID_KEY } from "../firebaseConfig.js";

/**
 * Pide permiso al usuario, obtiene un token FCM y lo guarda en Firestore.
 * Se guarda en `comercios/{slug}/fcmTokens/{tokenHash}` con el uid del usuario,
 * de modo que un Cloud Function pueda buscarlos al crear un pedido y mandar push.
 *
 * Devuelve el token, o null si:
 *  - El navegador no soporta Messaging (iOS < 16.4)
 *  - El usuario rechazó la notificación
 *  - Falta VITE_FIREBASE_VAPID_KEY
 *
 * Idempotente: llamarlo varias veces sólo refresca el timestamp.
 */
export async function registrarFCMToken({ slug, user, addToast }) {
  if (!slug || !user?.uid) return null;
  if (!VAPID_KEY) {
    console.warn("[FCM] Falta VITE_FIREBASE_VAPID_KEY en .env. Push notifications deshabilitadas.");
    return null;
  }

  const messaging = await getMessagingInstance();
  if (!messaging) return null;

  // Pedir permiso si todavía no se otorgó
  if ("Notification" in window && Notification.permission === "default") {
    const result = await Notification.requestPermission();
    if (result !== "granted") {
      addToast?.("Notificaciones rechazadas. Activalas desde el ícono del candado.", "info");
      return null;
    }
  }
  if (Notification.permission !== "granted") return null;

  try {
    // El SW de FCM debe estar registrado en /firebase-messaging-sw.js (lo hace
    // automáticamente getToken si encuentra el archivo en /public).
    const swReg = await navigator.serviceWorker.getRegistration("/firebase-messaging-sw.js")
      || await navigator.serviceWorker.register("/firebase-messaging-sw.js");

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: swReg,
    });

    if (!token) {
      console.warn("[FCM] No se obtuvo token (¿permiso denegado?)");
      return null;
    }

    // Guardar en Firestore: comercios/{slug}/fcmTokens/{tokenHash}
    // El docId es un hash corto del token para evitar duplicados del mismo dispositivo
    const tokenId = await hashToken(token);
    await setDoc(doc(db, "comercios", slug, "fcmTokens", tokenId), {
      token,
      uid: user.uid,
      email: user.email || null,
      userAgent: navigator.userAgent.slice(0, 200),
      registradoEn: serverTimestamp(),
    });

    return token;
  } catch (err) {
    console.error("[FCM] Error obteniendo token:", err);
    return null;
  }
}

/** Borra el token actual (logout) */
export async function eliminarFCMToken({ slug, token }) {
  if (!slug || !token) return;
  try {
    const tokenId = await hashToken(token);
    await deleteDoc(doc(db, "comercios", slug, "fcmTokens", tokenId));
  } catch (err) {
    console.warn("[FCM] No se pudo eliminar token:", err);
  }
}

/**
 * Suscribe a mensajes en foreground (cuando la pestaña está abierta).
 * El service worker maneja los mensajes en background automáticamente.
 *
 * Devuelve la función de cleanup.
 */
export async function suscribirMensajesForeground(handler) {
  const messaging = await getMessagingInstance();
  if (!messaging) return () => {};
  return onMessage(messaging, payload => {
    try {
      const { title, body, icon } = payload.notification || {};
      // Mostrar notificación nativa además del callback (porque en foreground el SW no la muestra)
      if ("Notification" in window && Notification.permission === "granted") {
        const n = new Notification(title || "Nuevo pedido", {
          body: body || "",
          icon: icon || "/logo-waves.png",
          tag: "waves-pedido",
        });
        n.onclick = () => { window.focus(); n.close(); };
      }
      handler?.(payload);
    } catch (err) { console.error("[FCM] onMessage handler error:", err); }
  });
}

// Hash SHA-1 del token, primeros 32 hex chars — sirve como ID estable por dispositivo
async function hashToken(token) {
  const data = new TextEncoder().encode(token);
  const buf  = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}
