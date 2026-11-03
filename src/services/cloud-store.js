import { doc, getDoc, runTransaction } from 'firebase/firestore';
import { db } from './firebase.js';
import { appState } from './app-store.js';
import { inventoryState } from './inventory-store.js';

const sharedRef = db ? doc(db, 'talleres3dboys', 'principal') : null;
const watchedFields = ['jobs','materials','purchases','sales','productos','clientes','consignaciones','jobMovements'];
let baseline = null;
let baselineReady = false;

function normalized(data = {}) {
  return {
    jobs: Array.isArray(data.jobs) ? data.jobs : [],
    materials: Array.isArray(data.materials) ? data.materials : [],
    purchases: Array.isArray(data.purchases) ? data.purchases : [],
    sales: Array.isArray(data.sales) ? data.sales : [],
    productos: Array.isArray(data.productos) ? data.productos : (Array.isArray(data.products) ? data.products : []),
    clientes: Array.isArray(data.clientes) ? data.clientes : (Array.isArray(data.clients) ? data.clients : []),
    consignaciones: Array.isArray(data.consignaciones) ? data.consignaciones : (Array.isArray(data.consignments) ? data.consignments : []),
    jobMovements: Array.isArray(data.jobMovements) ? data.jobMovements : [],
  };
}
function signature(data, exists) { return JSON.stringify({ exists, ...normalized(data) }); }

export async function readSharedState() {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  const snapshot = await getDoc(sharedRef);
  const raw = snapshot.exists() ? snapshot.data() : {};
  baseline = signature(raw, snapshot.exists());
  baselineReady = true;
  const data = normalized(raw);
  return {
    exists: snapshot.exists(),
    hasRecords: watchedFields.some(field => Array.isArray(raw[field]) && raw[field].length > 0) ||
      Boolean(raw.products?.length || raw.clients?.length || raw.consignments?.length),
    data: {
      jobs: data.jobs, materials: data.materials, purchases: data.purchases, sales: data.sales,
      products: data.productos, clients: data.clientes, consignments: data.consignaciones,
      jobMovements: data.jobMovements,
    },
  };
}
export async function writeSharedState() {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  if (!baselineReady) throw new Error('Primero debes leer el documento compartido de Firebase.');
  const payload = {
    jobs: appState.jobs, materials: inventoryState.materials, purchases: inventoryState.purchases,
    sales: appState.sales, productos: appState.products, clientes: appState.clients,
    consignaciones: appState.consignments, jobMovements: inventoryState.jobMovements,
  };
  await runTransaction(db, async transaction => {
    const snapshot = await transaction.get(sharedRef);
    const current = snapshot.exists() ? snapshot.data() : {};
    if (signature(current, snapshot.exists()) !== baseline) {
      throw new Error('CONFLICTO_NUBE: el documento cambió desde la última lectura. Se detuvo la sincronización para no sobrescribir cambios de otro usuario o de 3DBoys.');
    }
    transaction.set(sharedRef, payload, { merge: true });
  });
  baseline = signature(payload, true);
  return true;
}
