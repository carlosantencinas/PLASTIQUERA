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
export function applyJobMaterial(jobId, jobData) {
  const previous = inventoryState.jobMovements.find(item => item.jobId === jobId) || null;

  if (previous) {
    const oldMaterial = getMaterialById(previous.materialId);
    if (oldMaterial) oldMaterial.stock += previous.grams;
    inventoryState.jobMovements = inventoryState.jobMovements.filter(item => item.jobId !== jobId);
  }

  try {
    const materialId = String(jobData.materialId || 'manual');
    const grams = Number(jobData.gramos || 0);

    if (materialId === 'manual') return null;
    if (!Number.isFinite(grams) || grams <= 0) throw new Error('Indica una cantidad de gramos mayor que cero.');

    const material = getMaterialById(materialId);
    if (!material) throw new Error('El material seleccionado ya no existe en el inventario.');
    if (material.unidad !== 'g') throw new Error('El material seleccionado no está expresado en gramos.');

    if (grams > material.stock + 1e-9) {
      throw new Error(`Stock insuficiente de ${material.nombre}. Disponible: ${material.stock.toFixed(2)} g; solicitado: ${grams.toFixed(2)} g.`);
    }

    material.stock = Math.max(0, material.stock - grams);
    const movement = {
      id: makeId('consumo'),
      jobId,
      materialId,
      materialNombre: material.nombre,
      grams,
      costoUnitario: material.costoPromedio,
      costoTotal: grams * material.costoPromedio,
      fecha: Date.now(),
    };
    inventoryState.jobMovements.push(movement);
    return movement;
  } catch (error) {
    if (previous) {
      const oldMaterial = getMaterialById(previous.materialId);
      if (oldMaterial) oldMaterial.stock = Math.max(0, oldMaterial.stock - previous.grams);
      inventoryState.jobMovements.push(previous);
    }
    throw error;
  }
}

/** Devuelve al stock el consumo de un trabajo antes de eliminarlo. */
export function removeJobMaterial(jobId) {
  const movement = inventoryState.jobMovements.find(item => item.jobId === jobId);
  if (!movement) return false;
  const material = getMaterialById(movement.materialId);
  if (material) material.stock += movement.grams;
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
