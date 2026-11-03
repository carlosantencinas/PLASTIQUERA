import { inventoryState, loadInventorySnapshot } from './inventory-store.js';

const STORAGE_KEY = 'plastiqueria:data:v1';
export const appState = { jobs: [], products: [], clients: [], sales: [], consignments: [] };

export function loadAppState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    appState.jobs.splice(0, appState.jobs.length, ...(Array.isArray(data.jobs) ? data.jobs : []));
    appState.products = Array.isArray(data.products) ? data.products : (Array.isArray(data.productos) ? data.productos : []);
    appState.clients = Array.isArray(data.clients) ? data.clients : (Array.isArray(data.clientes) ? data.clientes : []);
    appState.sales = Array.isArray(data.sales) ? data.sales : [];
    appState.consignments = Array.isArray(data.consignments) ? data.consignments : (Array.isArray(data.consignaciones) ? data.consignaciones : []);
    loadInventorySnapshot({
      materials: data.materials || [],
      purchases: data.purchases || [],
      jobMovements: data.jobMovements || [],
    });
    appState.consignments.forEach(item => {
      if (item.cantidadDevuelta === undefined) item.cantidadDevuelta = item.estadoPago === 'Devuelto' ? item.cantidad : 0;
      if (item.estadoPago === 'Devuelto') item.estadoPago = 'Pendiente';
    });
    return true;
  } catch (error) {
    console.error('No se pudo leer el almacenamiento local de Plastiquería', error);
    return false;
  }
}

export function saveAppState() {
  const data = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    jobs: appState.jobs,
    products: appState.products,
    clients: appState.clients,
    sales: appState.sales,
    consignments: appState.consignments,
    materials: inventoryState.materials,
    purchases: inventoryState.purchases,
    jobMovements: inventoryState.jobMovements,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    window.dispatchEvent(new CustomEvent('plastiqueria:saved', { detail: { savedAt: data.savedAt } }));
    return true;
  } catch (error) {
    console.error('No se pudieron guardar los datos', error);
    window.alert('No se pudieron guardar los datos en este navegador. Exporta un respaldo y libera espacio.');
    return false;
  }
}

export function exportBackup() {
  const data = {
    app: 'Plastiquería',
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    jobs: appState.jobs,
    products: appState.products,
    clients: appState.clients,
    sales: appState.sales,
    consignments: appState.consignments,
    materials: inventoryState.materials,
    purchases: inventoryState.purchases,
    jobMovements: inventoryState.jobMovements,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'plastiqueria-respaldo-' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function importBackup(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || '{}'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('El archivo no contiene un respaldo válido.');
        const arrays = ['jobs','products','clients','sales','consignments','materials','purchases','jobMovements'];
        if (!arrays.some(key => Array.isArray(data[key]))) throw new Error('No se encontraron datos de Plastiquería en el archivo.');
        appState.jobs.splice(0, appState.jobs.length, ...(Array.isArray(data.jobs) ? data.jobs : []));
        appState.products = Array.isArray(data.products) ? data.products : (data.productos || []);
        appState.clients = Array.isArray(data.clients) ? data.clients : (data.clientes || []);
        appState.sales = Array.isArray(data.sales) ? data.sales : [];
        appState.consignments = Array.isArray(data.consignments) ? data.consignments : (data.consignaciones || []);
        loadInventorySnapshot({ materials: data.materials || [], purchases: data.purchases || [], jobMovements: data.jobMovements || [] });
        normalizeConsignments();
        restoreLegacyJobMovements();
        if (!saveAppState()) throw new Error('No se pudo guardar el respaldo importado en este navegador.');
        resolve(true);
      } catch (error) { reject(error); }
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.readAsText(file);
  });
}

export const makeId = prefix => globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
