/**
 * Reglas de inventario migradas de 3DBoys/index.html.
 * El stock se expresa en unidades base: g, ml o u.
 */
export const UNIT_INFO = Object.freeze({
  g: { base: 'g', factor: 1, label: 'g' },
  kg: { base: 'g', factor: 1000, label: 'kg' },
  ml: { base: 'ml', factor: 1, label: 'ml' },
  l: { base: 'ml', factor: 1000, label: 'L' },
  unidad: { base: 'u', factor: 1, label: 'unidad(es)' },
});

export function normalizePurchaseQuantity(quantity, unit) {
  const info = UNIT_INFO[unit];
  if (!info) throw new Error('Unidad de compra no reconocida.');
  const amount = Number(quantity);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('La cantidad debe ser mayor que cero.');
  return amount * info.factor;
}

/** Calcula el costo promedio ponderado, conservando el criterio original. */
export function weightedAverageEntry(material, quantityBase, totalPrice) {
  const quantity = Number(quantityBase);
  const price = Number(totalPrice);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La cantidad debe ser mayor que cero.');
  if (!Number.isFinite(price) || price <= 0) throw new Error('El precio total debe ser mayor que cero.');

  const oldValue = material.stock * material.costoPromedio;
  const newStock = material.stock + quantity;
  const newValue = oldValue + price;

  return {
    ...material,
    stock: newStock,
    costoPromedio: newStock > 0 ? newValue / newStock : 0,
  };
}

export function stockValue(material) {
  return material.stock * material.costoPromedio;
}

export function formatStock(material) {
  const unit = material.unidad === 'g' ? 'g' : material.unidad === 'ml' ? 'ml' : 'u';
  return `${Number(material.stock || 0).toLocaleString('es-BO', { maximumFractionDigits: 2 })} ${unit}`;
}

export function formatUnitCost(material) {
  if (material.unidad === 'g') return material.costoPromedio * 1000;
  if (material.unidad === 'ml') return material.costoPromedio * 1000;
  return material.costoPromedio;
}
