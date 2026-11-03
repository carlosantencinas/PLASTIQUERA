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
