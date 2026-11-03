import test from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateJob,
  getSellablePieces,
  getSuggestedUnitPrice,
} from '../src/calculations/jobs.js';

const sample = {
  gramos: 100,
  precioKg: 100,
  watts: 200,
  horasImpresion: 2,
  precioKwh: 1.5,
  mantenimiento: 0.5,
  horasTrabajo: 1,
  tarifaHora: 20,
  otros: 3,
  fallas: 10,
  margen: 20,
  piezasVendibles: 3,
};

test('conserva las fórmulas originales de costos y precio', () => {
  const result = calculateJob(sample);
  assert.equal(result.costoMaterial, 10);
  assert.equal(result.costoEnergia, 0.6);
  assert.equal(result.costoMantenimiento, 1);
  assert.equal(result.costoManoObra, 20);
  assert.equal(result.costoOtros, 3);
  assert.ok(Math.abs(result.costoFallas - 3.46) < 1e-10);
  assert.ok(Math.abs(result.costoTotal - 38.06) < 1e-10);
  assert.ok(Math.abs(result.ganancia - 7.612) < 1e-10);
  assert.ok(Math.abs(result.precioVenta - 45.672) < 1e-10);
  assert.ok(Math.abs(result.precioUnitario - 15.224) < 1e-10);
});

test('un lote sin piezas vendibles conserva el precio total como precioUnitario', () => {
  const result = calculateJob({ ...sample, piezasVendibles: 0 });
  assert.equal(result.precioUnitario, result.precioVenta);
});

test('trabajos antiguos sin piezasVendibles se interpretan como una pieza', () => {
  const job = {
    data: {},
    calc: { precioVenta: 50, precioUnitario: 25 },
  };
  assert.equal(getSellablePieces(job), 1);
  assert.equal(getSuggestedUnitPrice(job), 50);
});

test('lotes con varias piezas usan el precio unitario calculado', () => {
  const job = {
    data: { piezasVendibles: 2 },
    calc: { precioVenta: 50, precioUnitario: 25 },
  };
  assert.equal(getSellablePieces(job), 2);
  assert.equal(getSuggestedUnitPrice(job), 25);
});
