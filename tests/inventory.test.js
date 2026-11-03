import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePurchaseQuantity,
  weightedAverageEntry,
  stockValue,
} from '../src/calculations/inventory.js';

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
  assert.equal(second.costoPromedio, 190 / 1500);
  assert.equal(stockValue(second), 190);
});

test('mantiene costo promedio cuando se ajusta el stock por consumo manual', () => {
  const material = { stock: 800, costoPromedio: 0.1 };
  assert.equal(stockValue(material), 80);
});

test('rechaza unidades, cantidades y precios inválidos', () => {
  assert.throws(() => normalizePurchaseQuantity(1, 'lb'));
  assert.throws(() => normalizePurchaseQuantity(0, 'kg'));
  assert.throws(() => weightedAverageEntry({ stock: 0, costoPromedio: 0 }, 100, 0));
});
