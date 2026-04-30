import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getStorage } from "firebase/storage";
import { getMessaging, isSupported as messagingSupported } from "firebase/messaging";

// ✅ SEGURIDAD: Las claves se leen desde variables de entorno (.env)
// Nunca hardcodear claves en el código fuente.
export const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

const app = initializeApp(firebaseConfig);

export const db       = getFirestore(app);
export const auth     = getAuth(app);
export const provider = new GoogleAuthProvider();
export const storage  = getStorage(app);

// Messaging: solo se inicializa si el browser lo soporta (iOS Safari < 16.4 no)
export async function getMessagingInstance() {
  try {
    if (!(await messagingSupported())) return null;
    return getMessaging(app);
  } catch (err) {
    console.warn("[FCM] Messaging no disponible:", err);
    return null;
  }
}
