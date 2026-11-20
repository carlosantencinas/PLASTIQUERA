import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBackupData } from '../src/services/backup-validation.js';

function validBackup() {
  return {
    jobs: [{ id: 'j1', data: { productoId: 'p1', materialId: 'm1', clientId: 'c1', piezas: 2, piezasVendibles: 2, gramos: 30 } }],
    products: [{ id: 'p1', codigo: 'AM3D-001', variantes: [{ id: 'v1', codigo: 'AM3D-001-NEG' }] }],
    clients: [{ id: 'c1' }],
    sales: [{ id: 's1', jobId: 'j1', productoId: 'p1', clientId: 'c1', cantidad: 1, monto: 20 }],
    consignments: [{ id: 'co1', productoId: 'p1', clientId: 'c1', cantidad: 1, cantidadDevuelta: 0, precioUnitario: 20 }],
    expenses: [{ id: 'e1' }],
    materials: [{ id: 'm1', stock: 100, costoPromedio: 0.15 }],
    purchases: [{ id: 'pu1', cantidad: 1, precioTotal: 100 }],
    jobMovements: [{ id: 'mv1', jobId: 'j1', materialId: 'm1', grams: 30, costoTotal: 4.5 }],
  };
}

test('acepta respaldo completo y devuelve colecciones normalizadas', () => {
  const normalized = validateBackupData(validBackup());
  assert.equal(normalized.products[0].codigo, 'AM3D-001');
  assert.equal(normalized.jobMovements.length, 1);
});

test('acepta alias históricos en español', () => {
  const data = validBackup();
  data.productos = data.products; delete data.products;
  data.clientes = data.clients; delete data.clients;
  data.consignaciones = data.consignments; delete data.consignments;
  assert.equal(validateBackupData(data).products.length, 1);
});

test('rechaza listas faltantes, registros sin ID e IDs duplicados', () => {
  const missing = validBackup(); delete missing.sales;
  assert.throws(() => validateBackupData(missing), /falta la lista obligatoria/);
  const noId = validBackup(); noId.clients[0].id = '';
  assert.throws(() => validateBackupData(noId), /no tiene identificador/);
  const duplicate = validBackup(); duplicate.products.push({ id: 'p1', codigo: 'AM3D-002' });
  assert.throws(() => validateBackupData(duplicate), /identificadores duplicados/);
});

test('rechaza códigos duplicados entre productos y variantes sin distinguir mayúsculas', () => {
  const data = validBackup();
  data.products[0].variantes.push({ id: 'v2', codigo: 'am3d-001' });
  assert.throws(() => validateBackupData(data), /está repetido/);
});

test('rechaza referencias colgantes y cantidades o stocks inválidos', () => {
  const dangling = validBackup(); dangling.sales[0].jobId = 'no-existe';
  assert.throws(() => validateBackupData(dangling), /registro inexistente/);
  const badStock = validBackup(); badStock.materials[0].stock = -1;
  assert.throws(() => validateBackupData(badStock), /valor numérico no válido/);
  const badQty = validBackup(); badQty.sales[0].cantidad = 'muchas';
  assert.throws(() => validateBackupData(badQty), /valor numérico no válido/);
});
