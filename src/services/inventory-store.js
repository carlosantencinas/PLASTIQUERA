import {
  UNIT_INFO,
  normalizePurchaseQuantity,
  weightedAverageEntry,
} from '../calculations/inventory.js';

export const inventoryState = {
  materials: [],
  purchases: [],
};

const makeId = prefix =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function loadInventorySnapshot(snapshot = {}) {
  inventoryState.materials = Array.isArray(snapshot.materials) ? structuredClone(snapshot.materials) : [];
  inventoryState.purchases = Array.isArray(snapshot.purchases) ? structuredClone(snapshot.purchases) : [];
}

export function recordPurchase(data) {
  const category = String(data.category || '').trim();
  const name = String(data.name || '').trim();
  const quantity = Number(data.quantity);
  const unit = data.unit;
  const totalPrice = Number(data.totalPrice);

  if (!category || !name) throw new Error('Completa la categoría y el nombre.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad debe ser mayor que cero.');
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) throw new Error('El precio total debe ser mayor que cero.');
  if (!UNIT_INFO[unit]) throw new Error('Selecciona una unidad válida.');

  const purchase = {
    id: makeId('compra'),
    categoria: category,
    nombre: name,
    cantidad: quantity,
    unidad: unit,
    precioTotal: totalPrice,
    proveedor: String(data.supplier || '').trim(),
    compradoPor: String(data.purchasedBy || '').trim(),
    notas: String(data.notes || '').trim(),
    fecha: Number(data.date) || Date.now(),
    createdAt: Date.now(),
  };

  inventoryState.purchases.push(purchase);

  // Los equipos se registran en compras, pero no forman parte del stock consumible.
  if (category !== 'Equipo') {
    const baseUnit = UNIT_INFO[unit].base;
    let material = inventoryState.materials.find(item =>
      item.categoria === category &&
      item.unidad === baseUnit &&
      item.nombre.trim().toLowerCase() === name.toLowerCase()
    );

    if (!material) {
      material = {
        id: makeId('mat'),
        nombre: name,
        categoria: category,
        unidad: baseUnit,
        stock: 0,
        costoPromedio: 0,
      };
      inventoryState.materials.push(material);
    }

    const quantityBase = normalizePurchaseQuantity(quantity, unit);
    const updated = weightedAverageEntry(material, quantityBase, totalPrice);
    Object.assign(material, updated);
  }

  return purchase;
}

/** La eliminación del historial NO revierte la entrada de stock: así operaba 3DBoys. */
export function deletePurchase(id) {
  inventoryState.purchases = inventoryState.purchases.filter(item => item.id !== id);
}

export function setMaterialStock(id, stock) {
  const material = inventoryState.materials.find(item => item.id === id);
  if (!material) throw new Error('No se encontró el material.');
  const value = Number(stock);
  if (!Number.isFinite(value) || value < 0) throw new Error('El stock debe ser un número igual o mayor que cero.');
  material.stock = value;
  return material;
}

export function deleteMaterial(id) {
  inventoryState.materials = inventoryState.materials.filter(item => item.id !== id);
}

export function getInventorySummary(now = new Date()) {
  const monthPurchases = inventoryState.purchases
    .filter(item => {
      const date = new Date(item.fecha);
      return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
    })
    .reduce((sum, item) => sum + item.precioTotal, 0);

  return {
    totalSpent: inventoryState.purchases.reduce((sum, item) => sum + item.precioTotal, 0),
    monthSpent: monthPurchases,
    stockValue: inventoryState.materials.reduce((sum, item) => sum + item.stock * item.costoPromedio, 0),
    equipmentSpent: inventoryState.purchases
      .filter(item => item.categoria === 'Equipo')
      .reduce((sum, item) => sum + item.precioTotal, 0),
  };
}
