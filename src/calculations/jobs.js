/**
 * Cálculos de trabajos de impresión.
 *
 * Migrado de 3DBoys/index.html sin cambiar las fórmulas de negocio.
 * Las cantidades monetarias se mantienen como números JS (Bs).
 */

/**
 * Calcula los costos y el precio sugerido de un trabajo.
 * Se espera que los campos numéricos de `data` ya estén normalizados.
 */
export function calculateJob(data) {
  const costoMaterial = data.gramos * (data.precioKg / 1000);
  const costoEnergia = (data.watts / 1000) * data.horasImpresion * data.precioKwh;
  const costoMantenimiento = data.horasImpresion * data.mantenimiento;
  const costoManoObra = data.horasTrabajo * data.tarifaHora;
  const costoOtros = data.otros;
  const subtotal =
    costoMaterial +
    costoEnergia +
    costoMantenimiento +
    costoManoObra +
    costoOtros;
  const costoFallas = subtotal * (data.fallas / 100);
  const costoTotal = subtotal + costoFallas;
  const ganancia = costoTotal * (data.margen / 100);
  const precioVenta = costoTotal + ganancia;
  const piezasVendibles =
    data.piezasVendibles !== undefined ? data.piezasVendibles : 1;
  const precioUnitario =
    piezasVendibles > 0 ? precioVenta / piezasVendibles : precioVenta;

  return {
    costoMaterial,
    costoEnergia,
    costoMantenimiento,
    costoManoObra,
    costoOtros,
    costoFallas,
    costoTotal,
    ganancia,
    precioVenta,
    precioUnitario,
  };
}

/** Compatibilidad con trabajos antiguos que no guardaban piezasVendibles. */
export function getSellablePieces(job) {
  return job.data.piezasVendibles !== undefined
    ? job.data.piezasVendibles
    : 1;
}

/** Precio por pieza para lotes; precio total para trabajos de una sola pieza. */
export function getSuggestedUnitPrice(job) {
  return getSellablePieces(job) > 1
    ? job.calc.precioUnitario
    : job.calc.precioVenta;
}
