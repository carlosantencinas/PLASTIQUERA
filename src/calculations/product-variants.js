const normalizeCode = value => String(value ?? '').trim().toLocaleUpperCase('es');

export function listProductCodes(products = []) {
  return products.flatMap(product => [
    { code: product.codigo, productId: product.id, kind: 'product', variantId: null },
    ...(Array.isArray(product.variantes) ? product.variantes : []).map(variant => ({
      code: variant.codigo, productId: product.id, kind: 'variant', variantId: variant.id,
    })),
  ]).filter(item => normalizeCode(item.code));
}

export function isProductCodeAvailable(code, products = [], options = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) return false;
  return !listProductCodes(products).some(item =>
    normalizeCode(item.code) === normalized &&
    !(item.productId === options.productId && item.kind === options.kind && item.variantId === (options.variantId ?? null))
  );
}

export function validateVariantInput({ code, name }, products = [], options = {}) {
  const normalizedCode = String(code ?? '').trim();
  const normalizedName = String(name ?? '').trim();
  if (!normalizedCode || !normalizedName) throw new Error('El código y el nombre de la variante son obligatorios.');
  if (!isProductCodeAvailable(normalizedCode, products, options)) {
    throw new Error('Ese código ya está utilizado por otro producto o variante. Cada etiqueta debe tener un código único.');
  }
  return { codigo: normalizedCode, nombre: normalizedName };
}

export function getProductVariants(product) {
  return Array.isArray(product?.variantes) ? product.variantes : [];
}
