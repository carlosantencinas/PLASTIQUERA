const COLLECTIONS = [
  'jobs', 'products', 'clients', 'sales', 'consignments',
  'expenses', 'materials', 'purchases', 'jobMovements',
];

const aliases = {
  products: ['products', 'productos'],
  clients: ['clients', 'clientes'],
  consignments: ['consignments', 'consignaciones'],
};

function fail(message) {
  throw new Error('Respaldo inválido: ' + message + ' No se modificó la información actual.');
}

function requireFiniteIfPresent(record, field, label, { min = -Infinity } = {}) {
  if (record[field] === undefined || record[field] === null || record[field] === '') return;
  const value = Number(record[field]);
  if (!Number.isFinite(value) || value < min) fail(label + ' tiene un valor numérico no válido.');
}

function requireReference(value, ids, label) {
  if (value === undefined || value === null || value === '' || value === 'manual') return;
  if (!ids.has(value)) fail(label + ' apunta a un registro inexistente (' + value + ').');
}

/**
 * Valida la estructura y relaciones del respaldo antes de permitir que
 * sustituya el estado sincronizado. Acepta los nombres históricos en español.
 */
export function validateBackupData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('el archivo no contiene un objeto JSON.');
  const normalized = {};
  for (const key of COLLECTIONS) {
    const candidates = aliases[key] || [key];
    const value = candidates.map(name => data[name]).find(Array.isArray);
    if (!Array.isArray(value)) fail('falta la lista obligatoria "' + key + '".');
    normalized[key] = value;
  }

  const idSets = {};
  for (const key of COLLECTIONS) {
    const seen = new Set();
    normalized[key].forEach((record, index) => {
      if (!record || typeof record !== 'object' || Array.isArray(record)) fail(key + '[' + index + '] no es un registro válido.');
      const id = String(record.id ?? '').trim();
      if (!id) fail(key + '[' + index + '] no tiene identificador.');
      if (seen.has(id)) fail('hay identificadores duplicados en ' + key + ' (' + id + ').');
      seen.add(id);
    });
    idSets[key] = seen;
  }

  const productCodes = new Set();
  const addCode = (value, label) => {
    const code = String(value ?? '').trim().toLocaleLowerCase('es');
    if (!code) return;
    if (productCodes.has(code)) fail('el código "' + value + '" está repetido (' + label + ').');
    productCodes.add(code);
  };
  normalized.products.forEach(product => {
    addCode(product.codigo ?? product.code, 'producto');
    const variants = Array.isArray(product.variantes) ? product.variantes
      : Array.isArray(product.variants) ? product.variants : [];
    variants.forEach(variant => addCode(variant.codigo ?? variant.code, 'variante'));
  });

  normalized.materials.forEach(material => {
    requireFiniteIfPresent(material, 'stock', 'El stock del material', { min: 0 });
    requireFiniteIfPresent(material, 'costoPromedio', 'El costo promedio del material', { min: 0 });
  });
  normalized.sales.forEach(sale => {
    requireFiniteIfPresent(sale, 'cantidad', 'La cantidad de una venta', { min: 0 });
    requireFiniteIfPresent(sale, 'monto', 'El monto de una venta', { min: 0 });
    requireReference(sale.jobId, idSets.jobs, 'Una venta');
    requireReference(sale.productoId, idSets.products, 'Una venta');
    requireReference(sale.clientId, idSets.clients, 'Una venta');
  });
  normalized.jobs.forEach(job => {
    const jobData = job.data && typeof job.data === 'object' ? job.data : {};
    requireReference(jobData.productoId, idSets.products, 'Un trabajo');
    requireReference(jobData.materialId, idSets.materials, 'Un trabajo');
    requireReference(jobData.clientId, idSets.clients, 'Un trabajo');
    requireFiniteIfPresent(jobData, 'piezas', 'La cantidad de piezas de un trabajo', { min: 0 });
    requireFiniteIfPresent(jobData, 'piezasVendibles', 'Las piezas vendibles de un trabajo', { min: 0 });
    requireFiniteIfPresent(jobData, 'piezasFallidas', 'Las piezas fallidas de un trabajo', { min: 0 });
    requireFiniteIfPresent(jobData, 'gramos', 'Los gramos de un trabajo', { min: 0 });
  });
  normalized.consignments.forEach(item => {
    requireReference(item.productoId, idSets.products, 'Una consignación');
    requireReference(item.clientId, idSets.clients, 'Una consignación');
    requireFiniteIfPresent(item, 'cantidad', 'La cantidad de una consignación', { min: 0 });
    requireFiniteIfPresent(item, 'cantidadDevuelta', 'La cantidad devuelta de una consignación', { min: 0 });
    requireFiniteIfPresent(item, 'precioUnitario', 'El precio unitario de una consignación', { min: 0 });
  });
  normalized.purchases.forEach(purchase => {
    requireFiniteIfPresent(purchase, 'cantidad', 'La cantidad de una compra', { min: 0 });
    requireFiniteIfPresent(purchase, 'precioTotal', 'El precio de una compra', { min: 0 });
  });
  normalized.jobMovements.forEach(movement => {
    requireReference(movement.jobId, idSets.jobs, 'Un movimiento de material');
    requireReference(movement.materialId, idSets.materials, 'Un movimiento de material');
    requireFiniteIfPresent(movement, 'grams', 'Los gramos de un movimiento');
    requireFiniteIfPresent(movement, 'costoTotal', 'El costo de un movimiento');
  });

  return normalized;
}
