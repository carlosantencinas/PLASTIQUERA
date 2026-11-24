import { collection, doc, getDoc, getDocs, onSnapshot, runTransaction, writeBatch } from 'firebase/firestore';
import { db } from './firebase.js';
import { appState } from './app-store.js';
import { inventoryState } from './inventory-store.js';
import { getProductVariants } from '../calculations/product-variants.js';

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

  const catalogOverrides = appState.settings?.catalogoPublicaciones && typeof appState.settings.catalogoPublicaciones === 'object'
    ? appState.settings.catalogoPublicaciones : {};
  const overrideFields = id => {
    const fields = catalogOverrides[id]?.fields;
    return fields && typeof fields === 'object' ? fields : {};
  };
  const productDocumentId = product => 'producto_' + String(product.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const documentId = job => 'trabajo_' + String(job.id).replace(/[^a-zA-Z0-9_-]/g, '_');
  const publishedProducts = appState.products.filter(product =>
    product?.publicadoCatalogo === true && catalogOverrides[productDocumentId(product)]?.visible !== false);
  const publishedJobs = appState.jobs.filter(job =>
    job?.data?.catalogoPublicado === true && catalogOverrides[documentId(job)]?.visible !== false);

  const productForJob = job => {
    const data = job?.data || {};
    const productId = data.catalogoProductoId || data.productoId || data.productId ||
      data.producto?.id || job?.productoId || job?.productId;
    if (productId) {
      const matched = appState.products.find(product => String(product.id) === String(productId));
      if (matched) return matched;
    }
    const productCode = data.codigoProducto || data.productCode || job?.codigoProducto || job?.productCode;
    return productCode
      ? appState.products.find(product => String(product.codigo || '').trim().toLocaleLowerCase('es') === String(productCode).trim().toLocaleLowerCase('es'))
      : null;
  };
  const eligibleJobs = publishedJobs.filter(job => Boolean(productForJob(job)));
  const generatedIds = new Set([...publishedProducts.map(productDocumentId), ...eligibleJobs.map(documentId)]);
  const existing = await getDocs(publicCatalogRef);
  const existingById = new Map(existing.docs.map(snapshot => [snapshot.id, snapshot.data() || {}]));
  const operations = [];

  // Retira documentos gestionados que ya no están publicados y aplica las retiradas manuales.
  for (const snapshot of existing.docs) {
    const data = snapshot.data() || {};
    const override = catalogOverrides[snapshot.id];
    const managed = data.gestionCatalogo === 'trabajos-v1' || data.gestionCatalogo === 'productos-v1';
    if (override?.visible === false || (managed && !generatedIds.has(snapshot.id))) {
      operations.push({ type: 'delete', ref: snapshot.ref });

  }

  // Productos: conserva los datos de origen y superpone las ediciones públicas.
  for (const product of publishedProducts) {
    const id = productDocumentId(product);
    const colors = getProductVariants(product)
      .filter(variant => variant && variant.activo !== false)
      .map(variant => String(variant.nombre || '').trim())
      .filter(Boolean);
    const imageUrl = String(product.imageUrl || '').trim();
    const base = {
      tipoRegistro: 'producto',
      gestionCatalogo: 'productos-v1',
      codigo: String(product.codigo || '').slice(0, 80),
      nombre: String(product.nombre || 'Producto').slice(0, 160),
      descripcion: String(product.descripcionCatalogo || '').slice(0, 1200),
      imagenUrl: /^https:\/\//i.test(imageUrl) ? imageUrl : '',
      precioVenta: Math.max(0, Number(product.precioVenta || 0)),
      colores: [...new Set(colors)].slice(0, 30),
      otrosColoresPedido: false,
      productoNombre: String(product.nombre || '').slice(0, 160),
      actualizadoEn: Date.now(),
    };
    operations.push({ type: 'set', ref: doc(publicCatalogRef, id), data: { ...base, ...overrideFields(id) } });
  }

  // Trabajos: la fotografía se hereda del producto vinculado.
  for (const job of eligibleJobs) {
    const data = job.data || {};
    const product = productForJob(job);
    const id = documentId(job);
    const colors = Array.isArray(data.catalogoColores)
      ? [...new Set(data.catalogoColores.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 30)
      : [];
    const imageUrl = String(product.imageUrl || '').trim();
    const base = {
      tipoRegistro: 'trabajo',
      gestionCatalogo: 'trabajos-v1',
      codigo: String(data.codigoCatalogo || '').slice(0, 80),
      nombre: String(data.nombre || product.nombre || 'Trabajo').slice(0, 160),
      descripcion: String(data.catalogoDescripcion || data.descripcion || product.descripcionCatalogo || '').slice(0, 1200),
      imagenUrl: /^https:\/\//i.test(imageUrl) ? imageUrl : '',
      precioVenta: Math.max(0, Number(data.catalogoPrecioVenta || 0)),
      colores,
      otrosColoresPedido: data.catalogoOtrosColores !== false,
      productoNombre: String(product.nombre || '').slice(0, 160),
      actualizadoEn: Date.now(),
    };
    operations.push({ type: 'set', ref: doc(publicCatalogRef, id), data: { ...base, ...overrideFields(id) } });
  }

  // Publicaciones antiguas sin producto/trabajo de origen también se pueden editar y reactivar.
  const sourceIds = new Set([
    ...appState.products.map(productDocumentId),
    ...appState.jobs.map(documentId),
  ]);
  for (const [id, override] of Object.entries(catalogOverrides)) {
    if (override?.visible !== true || generatedIds.has(id) || sourceIds.has(id)) continue;
    const previous = existingById.get(id) || {};
    const fields = overrideFields(id);
    operations.push({
      type: 'set',
      ref: doc(publicCatalogRef, id),
      data: {
        ...previous,
        ...fields,
        gestionCatalogo: previous.gestionCatalogo || 'edicion-manual-v1',
        tipoRegistro: fields.tipoRegistro || previous.tipoRegistro || 'producto',
        actualizadoEn: Date.now(),
      },
    });
  }

  await commitCatalogOperations(operations);
}
