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
