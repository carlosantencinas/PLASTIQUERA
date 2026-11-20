import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductStock, assertJobCanSell, assertProductCanMove, consignmentBalance } from '../src/calculations/commerce.js';

const jobs = [
  { id: 'j1', data: { productoId: 'p1', piezasVendibles: 10 } },
  { id: 'j2', data: { productoId: 'p1', piezasVendibles: 5 } },
];
test('stock de producto descuenta ventas vinculadas a trabajo o producto, sin duplicarlas', () => {
  const sales = [
    { id: 's1', jobId: 'j1', productoId: 'p1', cantidad: 2 },
    { id: 's2', jobId: 'j1', productoId: null, cantidad: 1 },
  ];
  const consignments = [{ productoId: 'p1', cantidad: 3, cantidadDevuelta: 1 }];
  assert.deepEqual(getProductStock('p1', jobs, sales, consignments), {
    produced: 15, sold: 3, consigned: 2, available: 10,
  });
});
test('una venta no puede superar las piezas restantes de un trabajo', () => {
  const job = jobs[0];
  assert.equal(assertJobCanSell(job, 8, [{ jobId: 'j1', cantidad: 2 }]), 8);
  assert.throws(() => assertJobCanSell(job, 9, [{ jobId: 'j1', cantidad: 2 }]), /Disponibles: 8/);
});
test('consignar producto valida existencias agregadas', () => {
  assert.equal(assertProductCanMove('p1', 10, jobs, [], []).available, 15);
  assert.throws(() => assertProductCanMove('p1', 16, jobs, [], []), /Disponibles: 15/);
});
test('saldo de consignación identifica deuda y saldo a favor por devoluciones', () => {
  assert.deepEqual(consignmentBalance({ cantidad: 5, cantidadDevuelta: 1, precioUnitario: 20, montoPagado: 50 }), {
    due: 80, paid: 50, pending: 30, credit: 0,
  });
  assert.deepEqual(consignmentBalance({ cantidad: 5, cantidadDevuelta: 3, precioUnitario: 20, montoPagado: 100 }), {
    due: 40, paid: 100, pending: 0, credit: 60,
  });
});

test('stock por variante separa colores y no clasifica movimientos históricos sin variante', async () => {
  const { getProductVariantStock, assertVariantCanMove } = await import('../src/calculations/commerce.js');
  const variantJobs = [
    { id: 'black-1', data: { productoId: 'p1', variantId: 'negro', piezasVendibles: 8 } },
    { id: 'yellow-1', data: { productoId: 'p1', variantId: 'amarillo', piezasVendibles: 5 } },
    { id: 'legacy-1', data: { productoId: 'p1', piezasVendibles: 3 } },
  ];
  const sales = [
    { id: 's-black', productoId: 'p1', variantId: 'negro', cantidad: 2 },
    { id: 's-yellow-job', jobId: 'yellow-1', productoId: 'p1', cantidad: 1 },
    { id: 's-legacy', productoId: 'p1', cantidad: 1 },
  ];
  const consignments = [
    { productoId: 'p1', variantId: 'negro', cantidad: 2, cantidadDevuelta: 1 },
    { productoId: 'p1', cantidad: 4, cantidadDevuelta: 0 },
  ];
  assert.deepEqual(getProductVariantStock('p1', 'negro', variantJobs, sales, consignments), {
    produced: 8, sold: 2, consigned: 1, available: 5,
  });
  assert.deepEqual(getProductVariantStock('p1', 'amarillo', variantJobs, sales, consignments), {
    produced: 5, sold: 1, consigned: 0, available: 4,
  });
  assert.equal(assertVariantCanMove('p1', 'negro', 5, variantJobs, sales, consignments).available, 5);
  assert.throws(() => assertVariantCanMove('p1', 'negro', 6, variantJobs, sales, consignments), /Disponibles: 5/);
});

test('venta sin variante vinculada a trabajo usa la variante del trabajo', async () => {
  const { getProductVariantStock } = await import('../src/calculations/commerce.js');
  const variantJobs = [{ id: 'j-negro', data: { productoId: 'p1', variantId: 'negro', piezasVendibles: 6 } }];
  const sales = [{ id: 's1', jobId: 'j-negro', cantidad: 2 }];
  assert.equal(getProductVariantStock('p1', 'negro', variantJobs, sales, []).available, 4);
});


test('lotes adicionales suman stock sin alterar producción original y admiten reversión trazable', async () => {
  const { getJobSellableQuantity, createProductionBatch, reverseProductionBatch } = await import('../src/calculations/commerce.js');
  const job = { id: 'job-1', data: { piezasVendibles: 4, productionBatches: [] } };
  const batch = createProductionBatch(job, {
    id: 'batch-1', date: 1795132800000, producedQuantity: 6, failedQuantity: 1,
    materialConsumptions: [{ materialId: 'pla-black', grams: 120 }, { materialId: 'pla-black', grams: 30 }],
  }, job.data.productionBatches);
  job.data.productionBatches.push(batch);
  assert.equal(getJobSellableQuantity(job), 9);
  assert.deepEqual(batch.materialConsumptions, [{ materialId: 'pla-black', grams: 150 }]);
  assert.throws(() => createProductionBatch(job, {
    id: 'batch-1', producedQuantity: 2, failedQuantity: 0,
  }, job.data.productionBatches), /ya existe/);
  const reversal = reverseProductionBatch(batch, 'Registro duplicado', 'rev-1');
  assert.deepEqual({ batchId: reversal.batchId, reason: reversal.reason, type: reversal.type }, {
    batchId: 'batch-1', reason: 'Registro duplicado', type: 'production-batch-reversal',
  });
  batch.status = 'reversed';
  assert.equal(getJobSellableQuantity(job), 4);
});

test('un lote rechaza cantidades inconsistentes y consumo de material inválido', async () => {
  const { createProductionBatch } = await import('../src/calculations/commerce.js');
  const job = { id: 'job-1', data: { piezasVendibles: 2 } };
  assert.throws(() => createProductionBatch(job, { id: 'b1', producedQuantity: 3, failedQuantity: 4 }), /fallidas/);
  assert.throws(() => createProductionBatch(job, { id: 'b2', producedQuantity: 3, materialConsumptions: [{ materialId: 'pla', grams: 0 }] }), /gramos mayores/);
});
