import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db } from './firebase.js';
import { appState } from './app-store.js';
import { inventoryState } from './inventory-store.js';

const sharedRef = db ? doc(db, 'plastiqueria', 'principal') : null;
const watchedFields = ['jobs','materials','purchases','sales','productos','clientes','consignaciones','expenses','jobMovements','settings'];
let initialReadCompleted = false;
let baseRevision = 0;
let localDirty = false;
let writeInProgress = false;

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
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  };
}

function publicData(data) {
  const value = normalized(data);
  return {
    jobs: value.jobs, materials: value.materials, purchases: value.purchases,
    sales: value.sales, products: value.productos, clients: value.clientes,
    consignments: value.consignaciones, expenses: value.expenses,
    jobMovements: value.jobMovements, settings: value.settings,
  };
}

export async function readSharedState() {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  const snapshot = await getDoc(sharedRef);
  const raw = snapshot.exists() ? snapshot.data() : {};
  baseRevision = Number.isInteger(raw._revision) ? raw._revision : 0;
  initialReadCompleted = true;
  const data = normalized(raw);
  return {
    exists: snapshot.exists(),
    hasRecords: watchedFields.some(field => Array.isArray(raw[field]) && raw[field].length > 0) ||
      Boolean(raw.products?.length || raw.clients?.length || raw.consignments?.length),
    data: publicData(data),
  };
}

export function markSharedStateDirty() {
  localDirty = true;
}

export function subscribeSharedState(onChange, onError = () => {}, onConflict = () => {}) {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  return onSnapshot(sharedRef, { includeMetadataChanges: true }, snapshot => {
    if (snapshot.metadata.hasPendingWrites) return;
    const raw = snapshot.exists() ? snapshot.data() : {};
    const revision = Number.isInteger(raw._revision) ? raw._revision : 0;
    if (revision === baseRevision) return;
    if (localDirty || writeInProgress) {
      onConflict({ expectedRevision: baseRevision, remoteRevision: revision });
      return;
    }
    baseRevision = revision;
    onChange({ exists: snapshot.exists(), data: publicData(raw), revision });
  }, onError);
}

export async function writeSharedState() {
  if (!sharedRef) throw new Error('Firebase no está configurado.');
  if (!initialReadCompleted) throw new Error('Primero debes leer el documento compartido de Firebase.');
  const expectedRevision = baseRevision;
  const payload = {
    jobs: appState.jobs, materials: inventoryState.materials, purchases: inventoryState.purchases,
    sales: appState.sales, productos: appState.products, clientes: appState.clients,
    consignaciones: appState.consignments, expenses: appState.expenses, jobMovements: inventoryState.jobMovements,
    settings: appState.settings,
  };
  writeInProgress = true;
  try {
    const nextRevision = await runTransaction(db, async transaction => {
      const snapshot = await transaction.get(sharedRef);
      const raw = snapshot.exists() ? snapshot.data() : {};
      const actualRevision = Number.isInteger(raw._revision) ? raw._revision : 0;
      if (actualRevision !== expectedRevision) {
        const error = new Error('CONFLICTO_NUBE: otro administrador modificó los datos. Se bloqueó el guardado para evitar sobrescribir sus cambios. Recarga los datos antes de continuar.');
        error.code = 'app/cloud-conflict';
        throw error;
      }
      const revision = actualRevision + 1;
      transaction.set(sharedRef, { ...payload, _revision: revision }, { merge: true });
      return revision;
    });
    baseRevision = nextRevision;
    localDirty = false;
    return true;
  } finally {
    writeInProgress = false;
  }
}
