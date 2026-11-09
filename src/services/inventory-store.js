import {
  UNIT_INFO,
  normalizePurchaseQuantity,
  weightedAverageEntry,
} from '../calculations/inventory.js';

export const inventoryState = {
  materials: [],
  purchases: [],
  jobMovements: [],
};

const makeId = prefix =>
  globalThis.crypto?.randomUUID?.() ?? `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export function loadInventorySnapshot(snapshot = {}) {
  inventoryState.materials = Array.isArray(snapshot.materials) ? structuredClone(snapshot.materials) : [];
  inventoryState.purchases = Array.isArray(snapshot.purchases) ? structuredClone(snapshot.purchases) : [];
  inventoryState.jobMovements = Array.isArray(snapshot.jobMovements) ? structuredClone(snapshot.jobMovements) : [];
}

export function getMaterialById(id) {
  return inventoryState.materials.find(item => item.id === id) || null;
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

/** El historial se elimina sin revertir la entrada de stock, por compatibilidad con 3DBoys. */
export function deletePurchase(id) {
  inventoryState.purchases = inventoryState.purchases.filter(item => item.id !== id);
}

export function setMaterialStock(id, stock) {
  const material = getMaterialById(id);
  if (!material) throw new Error('No se encontró el material.');
  const value = Number(stock);
  if (!Number.isFinite(value) || value < 0) throw new Error('El stock debe ser un número igual o mayor que cero.');
  material.stock = value;
  return material;
}

export function deleteMaterial(id) {
  if (inventoryState.jobMovements.some(movement => movement.materialId === id)) {
    throw new Error('No se puede eliminar un material que está asociado a trabajos. Revisa primero los movimientos.');
  }
  inventoryState.materials = inventoryState.materials.filter(item => item.id !== id);
}

/**
 * Aplica el consumo de material de un trabajo de forma idempotente.
 * Al editar, primero revierte el movimiento anterior y luego registra el nuevo.
 * Si el nuevo consumo no es válido, restaura el movimiento previo.
 */
export function applyJobMaterials(jobId, jobData) {
  const previous = inventoryState.jobMovements.filter(item => item.jobId === jobId);
  const restorePrevious = () => {
    for (const movement of previous) {
      const material = getMaterialById(movement.materialId);
      if (material) material.stock += Number(movement.grams || 0);
    }
  };
  restorePrevious();
  inventoryState.jobMovements = inventoryState.jobMovements.filter(item => item.jobId !== jobId);
  try {
    const rows = Array.isArray(jobData.materiales) && jobData.materiales.length
      ? jobData.materiales
      : [{ materialId: jobData.materialId || 'manual', gramos: jobData.gramos, color: '' }];
    const requested = rows.map(row => ({
      materialId: String(row.materialId || 'manual'),
      grams: Number(row.gramos ?? row.grams ?? 0),
      color: String(row.color || '').trim(),
      extruder: row.extruder || null,
      source: row.source || jobData.fuenteConsumo || 'manual',
    })).filter(row => row.grams > 0 && row.materialId !== 'manual');
    for (const row of requested) {
      if (!Number.isFinite(row.grams) || row.grams <= 0) throw new Error('Cada consumo debe tener gramos mayores que cero.');
      const material = getMaterialById(row.materialId);
      if (!material) throw new Error('Uno de los filamentos seleccionados ya no existe en el inventario.');
      if (material.unidad !== 'g') throw new Error(`El material ${material.nombre} no está expresado en gramos.`);
    }
    const totals = new Map();
    for (const row of requested) totals.set(row.materialId, (totals.get(row.materialId) || 0) + row.grams);
    for (const [materialId, grams] of totals) {
      const material = getMaterialById(materialId);
      if (grams > material.stock + 1e-9) throw new Error(`Stock insuficiente de ${material.nombre}. Disponible: ${material.stock.toFixed(2)} g; solicitado: ${grams.toFixed(2)} g.`);
    }
    const movements = requested.map(row => {
      const material = getMaterialById(row.materialId);
      material.stock = Math.max(0, material.stock - row.grams);
      const movement = {
        id: makeId('consumo'), jobId, jobNombre: String(jobData.nombre || ''),
        materialId: material.id, materialNombre: material.nombre, materialColor: row.color,
        extruder: row.extruder, source: row.source, grams: row.grams,
        costoUnitario: material.costoPromedio, costoTotal: row.grams * material.costoPromedio,
        fecha: Date.now(),
      };
      inventoryState.jobMovements.push(movement);
      return movement;
    });
    return movements.length ? movements : null;
  } catch (error) {
    restorePrevious();
    inventoryState.jobMovements.push(...previous);
    throw error;
  }
}

/** Compatibilidad con trabajos históricos que utilizaban un solo filamento. */
export function applyJobMaterial(jobId, jobData) {
  const movements = applyJobMaterials(jobId, jobData);
  return movements?.[0] || null;
}

/** Devuelve al stock el consumo de un trabajo antes de eliminarlo. */
export function removeJobMaterial(jobId) {
  const movements = inventoryState.jobMovements.filter(item => item.jobId === jobId);
  if (!movements.length) return false;
  for (const movement of movements) {
    const material = getMaterialById(movement.materialId);
    if (material) material.stock += Number(movement.grams || 0);
  }
  inventoryState.jobMovements = inventoryState.jobMovements.filter(item => item.jobId !== jobId);
  return true;
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
    jobConsumption: inventoryState.jobMovements.reduce((sum, item) => sum + item.costoTotal, 0),
  };
}
