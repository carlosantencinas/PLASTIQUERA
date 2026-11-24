import { collection, doc, getDoc, getDocs, onSnapshot, runTransaction, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';
import { appState } from './app-store.js';
import { inventoryState } from './inventory-store.js';

const sharedRef = db ? doc(db, 'plastiqueria', 'principal') : null;
const publicCatalogRef = db ? collection(db, 'catalogo_publico') : null;
const watchedFields = ['jobs','materials','purchases','sales','productos','clientes','consignaciones','expenses','jobMovements','settings'];
let initialReadCompleted = false;
let baseRevision = 0;
let localDirty = false;
let writeInProgress = false;
let publicCatalogSyncError = null;

export function getPublicCatalogSyncError() {
  return publicCatalogSyncError;
}

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

    // El documento principal ya quedó confirmado. El catálogo público es una
    // proyección secundaria: su fallo no debe invalidar ni revertir el guardado.
    try {
      await synchronizePublicCatalog();
      publicCatalogSyncError = null;
    } catch (error) {
      publicCatalogSyncError = error;
      console.error('Los datos principales se guardaron, pero falló la sincronización del catálogo público:', error);
    }
    return true;
  } finally {
    writeInProgress = false;
  }
}

// Firestore admite como máximo 500 operaciones por WriteBatch.
// Se usa un margen de 450 para evitar alcanzar el límite al agregar operaciones futuras.
async function commitCatalogOperations(operations, chunkSize = 450) {
  for (let offset = 0; offset < operations.length; offset += chunkSize) {
    const batch = writeBatch(db);
    const chunk = operations.slice(offset, offset + chunkSize);
    for (const operation of chunk) {
      if (operation.type === 'delete') batch.delete(operation.ref);
      else batch.set(operation.ref, operation.data);
    }
    await batch.commit();
  }
}

async function synchronizePublicCatalog() {
  if (!publicCatalogRef) return;
  const publishedJobs = appState.jobs.filter(job => job?.data?.catalogoPublicado === true);
  const productForJob = job => {
    const productId = job?.data?.catalogoProductoId || job?.data?.productoId;
    return appState.products.find(product => String(product.id) === String(productId));
  };
  const documentId = job => 'trabajo_' + String(job.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const eligibleJobs = publishedJobs.filter(job => {
    const product = productForJob(job);
    return product && /^https:\/\//i.test(String(product.imageUrl || ''));
  });
  const publishedIds = new Set(eligibleJobs.map(documentId));
  const existing = await getDocs(publicCatalogRef);
  const operations = [];

  // Solo se administran los documentos creados por este flujo nuevo.
  // Los documentos de productos y las publicaciones históricas de trabajos se conservan.
  for (const snapshot of existing.docs) {
    if (snapshot.id.startsWith('trabajo_') && !publishedIds.has(snapshot.id)) {
      operations.push({ type: 'delete', ref: snapshot.ref });
    }
  }

  for (const job of eligibleJobs) {
    const data = job.data || {};
    const product = productForJob(job);
    const id = documentId(job);
    const colors = Array.isArray(data.catalogoColores)
      ? [...new Set(data.catalogoColores.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 30)
      : [];
    operations.push({
      type: 'set',
      ref: doc(publicCatalogRef, id),
      data: {
        tipoRegistro: 'trabajo',
        codigo: String(data.codigoCatalogo || '').slice(0, 80),
        nombre: String(data.nombre || product.nombre || 'Trabajo').slice(0, 160),
        descripcion: String(data.catalogoDescripcion || data.descripcion || product.descripcionCatalogo || '').slice(0, 1200),
        imagenUrl: /^https:\/\//i.test(String(product.imageUrl || '')) ? String(product.imageUrl) : '',
        precioVenta: Math.max(0, Number(data.catalogoPrecioVenta || 0)),
        colores,
        otrosColoresPedido: data.catalogoOtrosColores !== false,
        productoNombre: String(product.nombre || '').slice(0, 160),
        actualizadoEn: Date.now(),
      },
    });
  }

  await commitCatalogOperations(operations);
}
