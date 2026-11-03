import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
const isConfigured = requiredKeys.every((key) => Boolean(config[key]));

let app = null;
let auth = null;
let db = null;

if (isConfigured) {
  app = getApps().length ? getApps()[0] : initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
}

export { app, auth, db };

export function getFirebaseStatus() {
  return isConfigured
    ? { configured: true, label: 'Configuración lista', message: 'Firebase está configurado. La lectura y escritura de datos aún no se han habilitado en esta etapa.' }
    : { configured: false, label: 'Pendiente de configuración', message: 'Añade las variables de Firebase en .env.local para preparar la conexión. No se realizan operaciones sobre la base de datos.' };
}
