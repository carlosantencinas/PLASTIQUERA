import test from 'node:test';
import assert from 'node:assert/strict';
import { getProductionBatchMaterialConsumptions } from '../src/calculations/production-consumption.js';

test('calcula consumo proporcional de una reimpresión desde los movimientos originales', () => {
  const job = { id: 'job-1', data: { piezas: 3 } };
  const movements = [
    { jobId: 'job-1', materialId: 'pla-black', grams: 120 },
    { jobId: 'job-1', materialId: 'pla-red', grams: 30 },
    { jobId: 'job-1', productionBatchId: 'old-batch', materialId: 'pla-black', grams: 80 },
    { jobId: 'other', materialId: 'pla-black', grams: 900 },
  ];
  assert.deepEqual(getProductionBatchMaterialConsumptions(job, movements, 2), [
    { materialId: 'pla-black', grams: 80 },
    { materialId: 'pla-red', grams: 20 },
  ]);
});

test('usa receta histórica del trabajo cuando no existen movimientos base', () => {
  const job = { id: 'job-2', data: { piezas: 4, materiales: [
    { materialId: 'pla', gramos: 200 },
    { materialId: 'petg', gramos: 80 },
  ] } };
  assert.deepEqual(getProductionBatchMaterialConsumptions(job, [], 1), [
    { materialId: 'pla', grams: 50 },
    { materialId: 'petg', grams: 20 },
  ]);
});

test('rechaza cantidades de reimpresión inválidas', () => {
  assert.throws(() => getProductionBatchMaterialConsumptions({ id: 'j', data: { piezas: 2 } }, [], 0), /entero mayor que cero/);
});

test('no usa movimientos de reversión de lotes como receta original', () => {
  const job = { id: 'job-3', data: { piezas: 2 } };
  const movements = [{ jobId: 'job-3', materialId: 'pla', grams: 50, productionBatchReversalId: 'rev-1' }];
  assert.deepEqual(getProductionBatchMaterialConsumptions(job, movements, 1), []);
});
