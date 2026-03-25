import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyASpLhGwZjUy_I-82CyXYVW1U3uwcTAUKQ",
  authDomain: "waves-qr1.firebaseapp.com",
  projectId: "waves-qr1",
  storageBucket: "waves-qr1.firebasestorage.app",
  messagingSenderId: "67955398448",
  appId: "1:67955398448:web:d535c7466d65a5695d1af5",
  measurementId: "G-EXLW33HVDP"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);

// 
export const db = getFirestore(app);
export const auth = getAuth(app); 
export const provider = new GoogleAuthProvider();