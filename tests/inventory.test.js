import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePurchaseQuantity,
  weightedAverageEntry,
  stockValue,
} from '../src/calculations/inventory.js';
import {
  inventoryState,
  loadInventorySnapshot,
  recordPurchase,
  deletePurchase,
  applyJobMaterial,
  applyJobMaterials,
  removeJobMaterial,
  applyProductionBatchMaterials,
  reverseProductionBatchMaterials,
} from '../src/services/inventory-store.js';

test('normaliza kg y litros a gramos y mililitros', () => {
  assert.equal(normalizePurchaseQuantity(1.5, 'kg'), 1500);
  assert.equal(normalizePurchaseQuantity(2, 'l'), 2000);
  assert.equal(normalizePurchaseQuantity(250, 'g'), 250);
});

test('calcula costo promedio ponderado con dos compras', () => {
  const first = weightedAverageEntry(
    { id: 'm1', stock: 0, costoPromedio: 0 },
    1000,
    100,
  );
  const second = weightedAverageEntry(first, 500, 90);
  assert.equal(second.stock, 1500);
  assert.ok(Math.abs(second.costoPromedio - 190 / 1500) < 1e-12);
  assert.ok(Math.abs(stockValue(second) - 190) < 1e-10);
});

test('una compra consumible crea o actualiza inventario', () => {
  loadInventorySnapshot();
  recordPurchase({
    category: 'Filamento', name: 'PLA negro', quantity: 1, unit: 'kg',
    totalPrice: 120, date: Date.now(),
  });
  recordPurchase({
    category: 'Filamento', name: 'pla NEGRO', quantity: 500, unit: 'g',
    totalPrice: 75, date: Date.now(),
  });

  assert.equal(inventoryState.materials.length, 1);
  assert.equal(inventoryState.materials[0].stock, 1500);
  assert.ok(Math.abs(inventoryState.materials[0].costoPromedio - 195 / 1500) < 1e-12);
  assert.equal(inventoryState.purchases.length, 2);
});

test('los equipos se registran en compras sin incrementar materiales', () => {
  loadInventorySnapshot();
  recordPurchase({
    category: 'Equipo', name: 'Boquilla 0.4', quantity: 2, unit: 'unidad',
    totalPrice: 50, date: Date.now(),
  });
  assert.equal(inventoryState.purchases.length, 1);
  assert.equal(inventoryState.materials.length, 0);
});

test('eliminar una compra del historial no revierte stock (compatibilidad 3DBoys)', () => {
  loadInventorySnapshot();
  const purchase = recordPurchase({
    category: 'Resina', name: 'Resina gris', quantity: 1, unit: 'l',
    totalPrice: 200, date: Date.now(),
  });
  deletePurchase(purchase.id);
  assert.equal(inventoryState.purchases.length, 0);
  assert.equal(inventoryState.materials[0].stock, 1000);
});

test('rechaza unidades, cantidades y precios inválidos', () => {
  assert.throws(() => normalizePurchaseQuantity(1, 'lb'));
  assert.throws(() => normalizePurchaseQuantity(0, 'kg'));
  assert.throws(() => weightedAverageEntry({ stock: 0, costoPromedio: 0 }, 100, 0));
});


test('consume material once, replace the consumption on edit, and restore on delete', () => {
  loadInventorySnapshot({
    materials: [{ id: 'pla', nombre: 'PLA negro', categoria: 'Filamento', unidad: 'g', stock: 1000, costoPromedio: 0.12 }],
  });

  applyJobMaterial('job-1', { materialId: 'pla', gramos: 100 });
  assert.equal(inventoryState.materials[0].stock, 900);
  assert.equal(inventoryState.jobMovements.length, 1);

  applyJobMaterial('job-1', { materialId: 'pla', gramos: 150 });
  assert.equal(inventoryState.materials[0].stock, 850);
  assert.equal(inventoryState.jobMovements.length, 1);
  assert.equal(inventoryState.jobMovements[0].grams, 150);

  removeJobMaterial('job-1');
  assert.equal(inventoryState.materials[0].stock, 1000);
  assert.equal(inventoryState.jobMovements.length, 0);
});

test('rechaza stock insuficiente y conserva el consumo anterior al editar', () => {
  loadInventorySnapshot({
    materials: [{ id: 'pla', nombre: 'PLA negro', categoria: 'Filamento', unidad: 'g', stock: 1000, costoPromedio: 0.12 }],
  });
  applyJobMaterial('job-2', { materialId: 'pla', gramos: 100 });

  assert.throws(
    () => applyJobMaterial('job-2', { materialId: 'pla', gramos: 2000 }),
    /Stock insuficiente/,
  );
  assert.equal(inventoryState.materials[0].stock, 900);
  assert.equal(inventoryState.jobMovements.length, 1);
  assert.equal(inventoryState.jobMovements[0].grams, 100);
});

test('cambiar un trabajo a costo manual devuelve el material consumido', () => {
  loadInventorySnapshot({
    materials: [{ id: 'pla', nombre: 'PLA negro', categoria: 'Filamento', unidad: 'g', stock: 1000, costoPromedio: 0.12 }],
  });
  applyJobMaterial('job-3', { materialId: 'pla', gramos: 250 });
  applyJobMaterial('job-3', { materialId: 'manual', gramos: 250 });
  assert.equal(inventoryState.materials[0].stock, 1000);
  assert.equal(inventoryState.jobMovements.length, 0);
});


test('consume varios filamentos por trabajo, reemplazar movimientos y restaurar al eliminar', () => {
  loadInventorySnapshot({ materials: [
    { id: 'black', nombre: 'PLA negro', unidad: 'g', stock: 100, costoPromedio: 0.12 },
    { id: 'white', nombre: 'PLA blanco', unidad: 'g', stock: 50, costoPromedio: 0.14 },
  ] });
  applyJobMaterials('multi-1', { nombre: 'Pieza bicolor', materiales: [
    { materialId: 'black', gramos: 30, color: 'Negro', extruder: '1' },
    { materialId: 'white', gramos: 15, color: 'Blanco', extruder: '2' },
  ] });
  assert.equal(inventoryState.materials.find(item => item.id === 'black').stock, 70);
  assert.equal(inventoryState.materials.find(item => item.id === 'white').stock, 35);
  assert.equal(inventoryState.jobMovements.length, 2);

  applyJobMaterials('multi-1', { nombre: 'Pieza bicolor', materiales: [
    { materialId: 'black', gramos: 25, color: 'Negro' },
    { materialId: 'white', gramos: 10, color: 'Blanco' },
  ] });
  assert.equal(inventoryState.materials.find(item => item.id === 'black').stock, 75);
  assert.equal(inventoryState.materials.find(item => item.id === 'white').stock, 40);
  assert.equal(inventoryState.jobMovements.length, 2);

  removeJobMaterial('multi-1');
  assert.equal(inventoryState.materials.find(item => item.id === 'black').stock, 100);
  assert.equal(inventoryState.materials.find(item => item.id === 'white').stock, 50);
  assert.equal(inventoryState.jobMovements.length, 0);
});

test('si falta stock en un color, no modifica ninguno de los stocks ni pierde los movimientos anteriores', () => {
  loadInventorySnapshot({ materials: [
    { id: 'black', nombre: 'PLA negro', unidad: 'g', stock: 100, costoPromedio: 0.12 },
    { id: 'white', nombre: 'PLA blanco', unidad: 'g', stock: 8, costoPromedio: 0.14 },
  ] });
  applyJobMaterials('multi-2', { nombre: 'Trabajo', materiales: [
    { materialId: 'black', gramos: 10 }, { materialId: 'white', gramos: 5 },
  ] });
  assert.throws(() => applyJobMaterials('multi-2', { nombre: 'Trabajo', materiales: [
    { materialId: 'black', gramos: 20 }, { materialId: 'white', gramos: 10 },
  ] }), /Stock insuficiente de PLA blanco/);
  assert.equal(inventoryState.materials.find(item => item.id === 'black').stock, 90);
  assert.equal(inventoryState.materials.find(item => item.id === 'white').stock, 3);
  assert.equal(inventoryState.jobMovements.length, 2);
});


test('lote adicional descuenta material una sola vez y no modifica el consumo original', () => {
  loadInventorySnapshot({
    materials: [{ id: 'pla', nombre: 'PLA negro', categoria: 'Filamento', unidad: 'g', stock: 1000, costoPromedio: 0.12 }],
    jobMovements: [{ id: 'original', jobId: 'job-1', materialId: 'pla', grams: 200, costoTotal: 24 }],
  });
  const job = { id: 'job-1', data: { nombre: 'Figura', gramos: 200 } };
  const batch = { id: 'batch-1', jobId: 'job-1', date: Date.now(), status: 'active', materialConsumptions: [{ materialId: 'pla', grams: 150 }] };
  const first = applyProductionBatchMaterials(job, batch);
  const retry = applyProductionBatchMaterials(job, batch);
  assert.equal(first.length, 1);
  assert.equal(retry.length, 1);
  assert.equal(inventoryState.materials[0].stock, 850);
  assert.equal(inventoryState.jobMovements.length, 2);
  assert.equal(inventoryState.jobMovements.find(item => item.id === 'original').grams, 200);
});

test('lote con stock insuficiente no descuenta ningún material', () => {
  loadInventorySnapshot({ materials: [
    { id: 'pla', nombre: 'PLA negro', unidad: 'g', stock: 100, costoPromedio: 0.12 },
    { id: 'petg', nombre: 'PETG blanco', unidad: 'g', stock: 5, costoPromedio: 0.14 },
  ] });
  const job = { id: 'job-2', data: { nombre: 'Pieza doble' } };
  const batch = { id: 'batch-2', jobId: 'job-2', status: 'active', materialConsumptions: [
    { materialId: 'pla', grams: 20 }, { materialId: 'petg', grams: 10 },
  ] };
  assert.throws(() => applyProductionBatchMaterials(job, batch), /Stock insuficiente de PETG blanco/);
  assert.equal(inventoryState.materials.find(item => item.id === 'pla').stock, 100);
  assert.equal(inventoryState.materials.find(item => item.id === 'petg').stock, 5);
  assert.equal(inventoryState.jobMovements.length, 0);
});

test('revertir consumo de lote restaura material con movimiento compensatorio trazable', () => {
  loadInventorySnapshot({ materials: [
    { id: 'pla', nombre: 'PLA negro', unidad: 'g', stock: 1000, costoPromedio: 0.12 },
  ] });
  const job = { id: 'job-3', data: { nombre: 'Figura' } };
  const batch = { id: 'batch-3', jobId: 'job-3', status: 'active', materialConsumptions: [{ materialId: 'pla', grams: 125 }] };
  applyProductionBatchMaterials(job, batch);
  const compensation = reverseProductionBatchMaterials(batch, 'reversal-3');
  assert.equal(inventoryState.materials[0].stock, 1000);
  assert.equal(compensation.length, 1);
  assert.equal(compensation[0].grams, -125);
  assert.equal(compensation[0].productionBatchReversalOf, 'batch-3');
  assert.equal(inventoryState.jobMovements.length, 2);
  assert.throws(() => reverseProductionBatchMaterials(batch, 'reversal-4'), /ya fue revertido/);
});
