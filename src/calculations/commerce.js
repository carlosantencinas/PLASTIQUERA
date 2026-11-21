export function positiveInteger(value, label = 'La cantidad') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(label + ' debe ser un entero mayor que cero.');
  return number;
}

export function getJobBaseSellableQuantity(job) {
  const data = job?.data || {};
  const explicit = data.piezasVendibles;
  const original = explicit !== undefined && explicit !== null
    ? Number(explicit)
    : Number(data.piezas ?? 1) - Number(data.piezasFallidas ?? 0);
  return Number.isFinite(original) ? Math.max(0, original) : 0;
}

export function getJobSellableQuantity(job) {
  const batches = Array.isArray(job?.data?.productionBatches) ? job.data.productionBatches : [];
  const additional = batches.reduce((sum, batch) => {
    if (batch.status === 'reversed') return sum;
    const quantity = Number(batch.sellableQuantity);
    return sum + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
  return getJobBaseSellableQuantity(job) + additional;
}

export function createProductionBatch(job, input, existingBatches = []) {
  if (!job?.id || !job?.data) throw new Error('Selecciona un trabajo válido.');
  const produced = Number(input?.producedQuantity);
  const failed = Number(input?.failedQuantity ?? 0);
  if (!Number.isSafeInteger(produced) || produced <= 0) throw new Error('La cantidad producida debe ser un entero mayor que cero.');
  if (!Number.isSafeInteger(failed) || failed < 0 || failed > produced) throw new Error('Las piezas fallidas deben ser un entero entre cero y la cantidad producida.');
  const batchId = String(input?.id || '').trim();
  if (!batchId || existingBatches.some(batch => batch.id === batchId)) throw new Error('El identificador del lote falta o ya existe.');
  const date = Number(input?.date || Date.now());
  if (!Number.isFinite(date) || date <= 0) throw new Error('La fecha del lote no es válida.');
  const consumptions = Array.isArray(input?.materialConsumptions) ? input.materialConsumptions.map(row => {
    const materialId = String(row?.materialId || '').trim();
    const grams = Number(row?.grams);
    if (!materialId || !Number.isFinite(grams) || grams <= 0) throw new Error('Cada consumo del lote requiere un material y gramos mayores que cero.');
    return { materialId, grams };
  }) : [];
  const merged = new Map();
  for (const row of consumptions) merged.set(row.materialId, (merged.get(row.materialId) || 0) + row.grams);
  return {
    id: batchId,
    jobId: job.id,
    date,
    producedQuantity: produced,
    failedQuantity: failed,
    sellableQuantity: produced - failed,
    materialConsumptions: [...merged].map(([materialId, grams]) => ({ materialId, grams })),
    variantId: String(input?.variantId || job.data?.variantId || '').trim() || null,
    variantName: String(input?.variantName || '').trim() || null,
    status: 'active',
    createdAt: Date.now(),
  };
}

export function reverseProductionBatch(batch, reason, reversalId) {
  if (!batch?.id || batch.status === 'reversed') throw new Error('El lote no existe o ya fue revertido.');
  const note = String(reason || '').trim();
  const id = String(reversalId || '').trim();
  if (!note || !id) throw new Error('La reversión requiere un motivo y un identificador.');
  return { id, batchId: batch.id, date: Date.now(), reason: note, type: 'production-batch-reversal' };
}

export function getJobSoldQuantity(jobId, sales) {
  return sales.filter(sale => sale.jobId === jobId).reduce((sum, sale) => sum + Number(sale.cantidad || 1), 0);
}

export function getProductStock(productId, jobs, sales, consignments) {
  // Un producto puede agrupar varios trabajos, incluso si cada uno corresponde a otro color.
  const productJobs = jobs.filter(job => job.data?.productoId === productId);
  const produced = productJobs.reduce((sum, job) => sum + getJobSellableQuantity(job), 0);
  const jobById = new Map(jobs.map(job => [job.id, job]));
  const sold = sales.filter(sale => {
    if (sale.productoId) return sale.productoId === productId;
    return jobById.get(sale.jobId)?.data?.productoId === productId;
  }).reduce((sum, sale) => sum + Number(sale.cantidad || 1), 0);
  const consigned = consignments.filter(item => item.productoId === productId)
    .reduce((sum, item) => sum + Math.max(0, Number(item.cantidad || 0) - Number(item.cantidadDevuelta || 0)), 0);
  return { produced, sold, consigned, available: Math.max(0, produced - sold - consigned) };
}

export function assertJobCanSell(job, quantity, sales) {
  const qty = positiveInteger(quantity);
  const sold = getJobSoldQuantity(job.id, sales);
  const available = Math.max(0, getJobSellableQuantity(job) - sold);
  if (qty > available) throw new Error('No hay suficientes piezas del trabajo. Disponibles: ' + available + '.');
  return available;
}

export function assertProductCanMove(productId, quantity, jobs, sales, consignments) {
  const qty = positiveInteger(quantity);
  const stock = getProductStock(productId, jobs, sales, consignments);
  if (qty > stock.available) throw new Error('Stock insuficiente del producto. Disponibles: ' + stock.available + '.');
  return stock;
}

export function consignmentBalance(item) {
  const returned = Math.max(0, Number(item.cantidadDevuelta || 0));
  const delivered = Math.max(0, Number(item.cantidad || 0));
  const due = Math.max(0, delivered - returned) * Math.max(0, Number(item.precioUnitario || 0));
  const paid = Math.max(0, Number(item.montoPagado || 0));
  return { due, paid, pending: Math.max(0, due - paid), credit: Math.max(0, paid - due) };
}

/**
 * Stock de una variante. Los movimientos antiguos sin variantId se excluyen
 * deliberadamente: quedan como stock histórico sin clasificar y no se asignan
 * automáticamente a un color/talla.
 */
export function getProductVariantStock(productId, variantId, jobs, sales, consignments) {
  if (!productId || !variantId) throw new Error('Selecciona un producto y una variante válidos.');
  const variantJobs = jobs.filter(job => job.data?.productoId === productId);
  const produced = variantJobs.reduce((sum, job) => {
    const base = job.data?.variantId === variantId ? getJobBaseSellableQuantity(job) : 0;
    const batches = (Array.isArray(job.data?.productionBatches) ? job.data.productionBatches : [])
      .filter(batch => batch.status !== 'reversed' && (batch.variantId || job.data?.variantId || null) === variantId)
      .reduce((total, batch) => total + Math.max(0, Number(batch.sellableQuantity) || 0), 0);
    return sum + base + batches;
  }, 0);
  const jobById = new Map(jobs.map(job => [job.id, job]));
  const saleBelongsToVariant = sale => {
    if (sale.productoId && sale.productoId !== productId) return false;
    const linkedJob = sale.jobId ? jobById.get(sale.jobId) : null;
    const saleVariantId = sale.variantId || linkedJob?.data?.variantId || null;
    const saleProductId = sale.productoId || linkedJob?.data?.productoId;
    return saleProductId === productId && saleVariantId === variantId;
  };
  const sold = sales.filter(saleBelongsToVariant)
    .reduce((sum, sale) => sum + Number(sale.cantidad || 1), 0);
  const consigned = consignments.filter(item =>
    item.productoId === productId && item.variantId === variantId
  ).reduce((sum, item) =>
    sum + Math.max(0, Number(item.cantidad || 0) - Number(item.cantidadDevuelta || 0)), 0);
  return { produced, sold, consigned, available: Math.max(0, produced - sold - consigned) };
}

export function assertVariantCanMove(productId, variantId, quantity, jobs, sales, consignments) {
  const qty = positiveInteger(quantity);
  const stock = getProductVariantStock(productId, variantId, jobs, sales, consignments);
  if (qty > stock.available) {
    throw new Error('Stock insuficiente de la variante. Disponibles: ' + stock.available + '.');
  }
  return stock;
}


/**
 * Comprueba que un lote pueda anularse sin dejar ventas ni consignaciones
 * sin respaldo. La comprobación global respeta el SKU/variante del trabajo.
 */
export function assertProductionBatchCanReverse(job, batch, jobs, sales, consignments) {
  if (!job?.id || !batch?.id || batch.jobId !== job.id) {
    throw new Error('El lote no corresponde al trabajo seleccionado.');
  }
  if (batch.status === 'reversed') throw new Error('El lote ya fue revertido.');
  const quantity = Number(batch.sellableQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('La cantidad vendible del lote no es válida.');
  }
  const jobAvailable = Math.max(0, getJobSellableQuantity(job) - getJobSoldQuantity(job.id, sales));
  if (quantity > jobAvailable) {
    throw new Error('El trabajo no tiene suficientes unidades disponibles sin comprometer ventas. Disponibles: ' + jobAvailable + '.');
  }
  let productAvailable = null;
  if (job.data?.productoId && (batch.variantId || job.data?.variantId)) {
    productAvailable = getProductVariantStock(job.data.productoId, batch.variantId || job.data.variantId, jobs, sales, consignments).available;
  } else if (job.data?.productoId) {
    productAvailable = getProductStock(job.data.productoId, jobs, sales, consignments).available;
  }
  if (productAvailable !== null && quantity > productAvailable) {
    throw new Error('El producto o variante tiene unidades vendidas o consignadas. Disponibles: ' + productAvailable + '.');
  }
  return { quantity, jobAvailable, productAvailable };
}
