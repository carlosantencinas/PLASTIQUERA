import test from 'node:test';
import assert from 'node:assert/strict';
import { isProductCodeAvailable, listProductCodes, validateVariantInput } from '../src/calculations/product-variants.js';

const products = [
  { id: 'p1', codigo: 'AM3D-ACC-0001', variantes: [
    { id: 'v1', codigo: 'AM3D-ACC-0001-NEG', nombre: 'Negro' },
    { id: 'v2', codigo: 'AM3D-ACC-0001-AMA', nombre: 'Amarillo' },
  ] },
  { id: 'p2', codigo: 'AM3D-ACC-0002' },
];

test('enumera código padre y códigos de cada variante', () => {
  assert.equal(listProductCodes(products).length, 4);
});

test('rechaza códigos repetidos ignorando mayúsculas y espacios', () => {
  assert.equal(isProductCodeAvailable(' am3d-acc-0001-neg ', products), false);
  assert.equal(isProductCodeAvailable('AM3D-ACC-0003', products), true);
});

test('permite conservar el código de la misma variante al editarla', () => {
  assert.equal(isProductCodeAvailable('AM3D-ACC-0001-NEG', products, {
    productId: 'p1', kind: 'variant', variantId: 'v1',
  }), true);
});

test('valida y normaliza los campos obligatorios de una variante', () => {
  assert.deepEqual(validateVariantInput({ code: ' AM3D-ACC-0001-BLA ', name: ' Blanco ' }, products), {
    codigo: 'AM3D-ACC-0001-BLA', nombre: 'Blanco',
  });
  assert.throws(() => validateVariantInput({ code: '', name: 'Blanco' }, products), /obligatorios/);
  assert.throws(() => validateVariantInput({ code: 'AM3D-ACC-0002', name: 'Blanco' }, products), /código ya está utilizado/);
});
