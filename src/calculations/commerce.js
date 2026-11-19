export function positiveInteger(value, label = 'La cantidad') {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(label + ' debe ser un entero mayor que cero.');
  return number;
}

export function getJobSellableQuantity(job) {
  const data = job?.data || {};
  const explicit = data.piezasVendibles;
  const quantity = explicit !== undefined && explicit !== null
    ? Number(explicit)
    : Number(data.piezas ?? 1) - Number(data.piezasFallidas ?? 0);
  return Number.isFinite(quantity) ? Math.max(0, quantity) : 0;
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
  const variantJobs = jobs.filter(job =>
    job.data?.productoId === productId && job.data?.variantId === variantId
  );
  const produced = variantJobs.reduce((sum, job) => sum + getJobSellableQuantity(job), 0);
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

