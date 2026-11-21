/**
 * Calcula el consumo de filamento de una reimpresión usando la receta
 * registrada en el trabajo original. Los movimientos de lotes anteriores y
 * sus compensaciones no forman parte de la receta base.
 */
export function getProductionBatchMaterialConsumptions(job, movements, producedQuantity) {
  const quantity = Number(producedQuantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error('La cantidad de reimpresión debe ser un entero mayor que cero.');
  const originalQuantity = Number(job?.data?.piezas ?? 1);
  if (!Number.isFinite(originalQuantity) || originalQuantity <= 0) {
    throw new Error('El trabajo original no tiene una cantidad de piezas válida para calcular el consumo.');
  }

  const originalMovements = (Array.isArray(movements) ? movements : []).filter(item =>
    item.jobId === job?.id && !item.productionBatchId && !item.productionBatchReversalId &&
    Number(item.grams) > 0 && item.materialId
  );
  const totals = new Map();
  for (const item of originalMovements) {
    totals.set(item.materialId, (totals.get(item.materialId) || 0) + Number(item.grams));
  }

  // Respaldo para trabajos antiguos sin movimiento de inventario detallado.
  if (!totals.size) {
    const rows = Array.isArray(job?.data?.materiales) && job.data.materiales.length
      ? job.data.materiales
      : [{ materialId: job?.data?.materialId, gramos: job?.data?.gramos }];
    for (const row of rows) {
      const materialId = String(row?.materialId || '').trim();
      const grams = Number(row?.gramos ?? row?.grams ?? 0);
      if (materialId && grams > 0) totals.set(materialId, (totals.get(materialId) || 0) + grams);
    }
  }

  return [...totals].map(([materialId, originalGrams]) => ({
    materialId,
    grams: Number((originalGrams / originalQuantity * quantity).toFixed(3)),
  })).filter(row => row.grams > 0);
}
