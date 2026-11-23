import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
const isConfigured = requiredKeys.every(key => Boolean(config[key]));
let app = null, auth = null, db = null, storage = null;
if (isConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = config.storageBucket ? getStorage(app) : null;
}
export { app, auth, db, storage, isConfigured as isFirebaseConfigured };
export function getFirebaseStatus() {
  return isConfigured
    ? { configured: true, label: 'Firebase disponible', message: 'Inicia sesión para cargar y sincronizar el documento compartido del taller.' }
    : { configured: false, label: 'Firebase no configurado', message: 'La aplicación requiere Firebase para iniciar sesión y guardar datos. No se guardarán datos localmente; configura las credenciales para continuar.' };
}
