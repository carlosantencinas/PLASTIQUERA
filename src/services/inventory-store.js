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
    if (category === 'Filamento' && /^#[0-9a-f]{6}$/i.test(String(data.colorHex || ''))) material.colorHex = data.colorHex;
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
    for (const movement of previous) {
      const material = getMaterialById(movement.materialId);
      if (material) material.stock = Math.max(0, material.stock - Number(movement.grams || 0));
    }
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


/**
 * Registra el consumo adicional de un lote sin tocar los movimientos del trabajo
 * original. La clave del lote hace que los reintentos sean idempotentes.
 */
export function applyProductionBatchMaterials(job, batch) {
  if (!job?.id || !batch?.id || batch.jobId !== job.id) throw new Error('El lote no corresponde a un trabajo válido.');
  if (batch.status !== 'active') throw new Error('Solo se puede consumir material para un lote activo.');
  const existing = inventoryState.jobMovements.filter(item => item.productionBatchId === batch.id);
  if (existing.length) {
    const expected = Array.isArray(batch.materialConsumptions) ? batch.materialConsumptions : [];
    const actual = new Map();
    for (const movement of existing) {
      if (movement.movementType !== 'production-batch-consumption') throw new Error('El lote tiene movimientos incompatibles; requiere revisión.');
      actual.set(movement.materialId, (actual.get(movement.materialId) || 0) + Number(movement.grams || 0));
    }
    const requested = new Map();
    for (const row of expected) requested.set(row.materialId, (requested.get(row.materialId) || 0) + Number(row.grams || 0));
    if (actual.size !== requested.size || [...requested].some(([id, grams]) => Math.abs((actual.get(id) || 0) - grams) > 1e-9)) {
      throw new Error('El lote ya tiene movimientos distintos a su consumo registrado.');
    }
    return existing;
  }

  const rows = Array.isArray(batch.materialConsumptions) ? batch.materialConsumptions : [];
  const totals = new Map();
  for (const row of rows) {
    const materialId = String(row?.materialId || '').trim();
    const grams = Number(row?.grams);
    if (!materialId || !Number.isFinite(grams) || grams <= 0) throw new Error('Cada consumo del lote requiere material y gramos mayores que cero.');
    totals.set(materialId, (totals.get(materialId) || 0) + grams);
  }
  for (const [materialId, grams] of totals) {
    const material = getMaterialById(materialId);
    if (!material) throw new Error('No se encontró uno de los materiales del lote.');
    if (material.unidad !== 'g') throw new Error(`El material ${material.nombre} no está expresado en gramos.`);
    if (grams > Number(material.stock || 0) + 1e-9) throw new Error(`Stock insuficiente de ${material.nombre}. Disponible: ${Number(material.stock || 0).toFixed(2)} g; solicitado: ${grams.toFixed(2)} g.`);
  }

  const movements = [];
  for (const [materialId, grams] of totals) {
    const material = getMaterialById(materialId);
    material.stock = Math.max(0, Number(material.stock || 0) - grams);
    const movement = {
      id: makeId('lote-consumo'), jobId: job.id, jobNombre: String(job.data?.nombre || ''),
      productionBatchId: batch.id, movementType: 'production-batch-consumption',
      materialId, materialNombre: material.nombre, materialColor: '',
      source: 'production-batch', grams, costoUnitario: Number(material.costoPromedio || 0),
      costoTotal: grams * Number(material.costoPromedio || 0), fecha: Number(batch.date) || Date.now(),
    };
    inventoryState.jobMovements.push(movement);
    movements.push(movement);
  }
  return movements;
}

/**
 * Revierte solo el consumo del lote indicado mediante movimientos compensatorios.
 * No elimina movimientos y no cambia el estado/cantidad vendible del lote: el
 * llamador debe comprobar antes que las unidades adicionales no estén comprometidas.
 */
export function reverseProductionBatchMaterials(batch, reversalId) {
  if (!batch?.id) throw new Error('Selecciona un lote válido.');
  const id = String(reversalId || '').trim();
  if (!id) throw new Error('La reversión requiere un identificador.');
  const original = inventoryState.jobMovements.filter(item =>
    item.productionBatchId === batch.id && item.movementType === 'production-batch-consumption'
  );
  if (!original.length && (batch.materialConsumptions || []).length) throw new Error('No se encontraron los consumos originales del lote.');
  if (inventoryState.jobMovements.some(item => item.productionBatchReversalId === id)) {
    throw new Error('El identificador de reversión ya fue utilizado.');
  }
  const alreadyReversed = inventoryState.jobMovements.some(item =>
    item.productionBatchReversalOf === batch.id
  );
  if (alreadyReversed) throw new Error('El consumo de este lote ya fue revertido.');
  const restored = [];
  for (const movement of original) {
    const material = getMaterialById(movement.materialId);
    if (!material) throw new Error('No se encontró un material necesario para revertir el lote.');
    if (!Number.isFinite(Number(movement.grams)) || Number(movement.grams) <= 0) throw new Error('El movimiento original del lote no es válido.');
  }
  for (const movement of original) {
    const material = getMaterialById(movement.materialId);
    const grams = Number(movement.grams);
    material.stock = Number(material.stock || 0) + grams;
    const compensation = {
      id: makeId('lote-reversion'), jobId: movement.jobId, jobNombre: movement.jobNombre,
      productionBatchId: batch.id, productionBatchReversalId: id,
      productionBatchReversalOf: batch.id, movementType: 'production-batch-consumption-reversal',
      materialId: material.id, materialNombre: material.nombre, materialColor: movement.materialColor || '',
      source: 'production-batch-reversal', grams: -grams,
      costoUnitario: Number(movement.costoUnitario || 0), costoTotal: -Number(movement.costoTotal || 0),
      fecha: Date.now(),
    };
    inventoryState.jobMovements.push(compensation);
    restored.push(compensation);
  }
  return restored;
}
