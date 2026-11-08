import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from './firebase.js';
import { appState } from './app-store.js';
import { inventoryState } from './inventory-store.js';

const sharedRef = db ? doc(db, 'plastiqueria', 'principal') : null;
const watchedFields = ['jobs','materials','purchases','sales','productos','clientes','consignaciones','expenses','jobMovements'];
let initialReadCompleted = false;

function normalized(data = {}) {
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    materials: Array.isArray(data.materials) ? data.materials : [],
    purchases: Array.isArray(data.purchases) ? data.purchases : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    productos: Array.isArray(data.productos) ? data.productos : (Array.isArray(data.products) ? data.products : []),
    clientes: Array.isArray(data.clientes) ? data.clientes : (Array.isArray(data.clients) ? data.clients : []),
    consignaciones: Array.isArray(data.consignaciones) ? data.consignaciones : (Array.isArray(data.consignments) ? data.consignments : []),
    expenses: Array.isArray(data.expenses) ? data.expenses : [],
    jobMovements: Array.isArray(data.jobMovements) ? data.jobMovements : [],
  };
}

export async function readSharedState() {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  const snapshot = await getDoc(sharedRef);
  const raw = snapshot.exists() ? snapshot.data() : {};
  initialReadCompleted = true;
  const data = normalized(raw);
  return {
    exists: snapshot.exists(),
    hasRecords: watchedFields.some(field => Array.isArray(raw[field]) && raw[field].length > 0) ||
      Boolean(raw.products?.length || raw.clients?.length || raw.consignments?.length),
    data: {
      jobs: data.jobs, materials: data.materials, purchases: data.purchases, sales: data.sales,
      products: data.productos, clients: data.clientes, consignments: data.consignaciones, expenses: data.expenses,
      jobMovements: data.jobMovements,
    },
  };
}

export function subscribeSharedState(onChange, onError = () => {}) {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  return onSnapshot(sharedRef, { includeMetadataChanges: true }, snapshot => {
    // Ignorar escrituras locales pendientes. La confirmación del servidor llegará
    // como un cambio de metadatos y permitirá aplicar el estado definitivo.
    if (snapshot.metadata.hasPendingWrites) return;
    const raw = snapshot.exists() ? snapshot.data() : {};
    const data = normalized(raw);
    onChange({
      exists: snapshot.exists(),
      data: {
        jobs: data.jobs, materials: data.materials, purchases: data.purchases, sales: data.sales,
        products: data.productos, clients: data.clientes, consignments: data.consignaciones,
        expenses: data.expenses, jobMovements: data.jobMovements,
      },
    });
  }, onError);
}

export async function writeSharedState() {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  if (!initialReadCompleted) throw new Error('Primero debes leer el documento compartido de Firebase.');
  const payload = {
    jobs: appState.jobs, materials: inventoryState.materials, purchases: inventoryState.purchases,
    sales: appState.sales, productos: appState.products, clientes: appState.clients,
    consignaciones: appState.consignments, expenses: appState.expenses, jobMovements: inventoryState.jobMovements,
  };
  await runTransaction(db, async transaction => {
    await transaction.get(sharedRef);
    // Se elimina la comparación con una copia antigua que generaba falsos conflictos.
    // La última sesión que guarde prevalece si hay ediciones simultáneas.
    transaction.set(sharedRef, payload, { merge: true });
  });
  return true;
}
