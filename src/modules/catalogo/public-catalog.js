import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../services/firebase.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const money = value => 'Bs ' + Number(value || 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});

export function renderPublicCatalog(root) {
  root.innerHTML = `
    <main class="public-catalog-page">
      <header class="public-catalog-header">
        <a href="${import.meta.env.BASE_URL}" class="public-catalog-brand"><img src="${import.meta.env.BASE_URL}imagotipo.svg" alt="AM3D"></a>
        <div><p class="eyebrow">AGENCIA DE MODELOS 3D</p><h1>Catálogo de productos y trabajos</h1><p>Productos y trabajos de impresión 3D disponibles en nuestro taller.</p></div>
      </header>
      <section class="public-catalog-toolbar">
        <label><span>Buscar trabajos</span><input id="publicCatalogSearch" type="search" placeholder="Nombre, código o detalle…"></label>
        <span id="publicCatalogCount" class="public-catalog-count">Cargando publicaciones…</span>
      </section>
      <section id="publicCatalogGrid" class="public-catalog-grid" aria-live="polite">
        <div class="public-catalog-empty">Cargando productos y trabajos publicados…</div>
      </section>
      <footer class="public-catalog-footer">Agencia de Modelos 3D · Catálogo público</footer>
    </main>`;
  if (!db) {
    root.querySelector('#publicCatalogGrid').innerHTML = '<p class="public-catalog-empty">Firebase no está configurado en esta versión de la aplicación.</p>';
    return;
  }
  let records = [];
  const grid = root.querySelector('#publicCatalogGrid');
  const search = root.querySelector('#publicCatalogSearch');
  const count = root.querySelector('#publicCatalogCount');
  const render = () => {
    const term = search.value.trim().toLocaleLowerCase('es');
    const filtered = records.filter(item => [item.nombre, item.codigo, item.descripcion, ...(Array.isArray(item.colores)?item.colores:[])]
      .join(' ').toLocaleLowerCase('es').includes(term));
    count.textContent = filtered.length + (filtered.length === 1 ? ' publicación' : ' publicaciones');
    grid.innerHTML = filtered.length ? filtered.map(item => `
      <article class="public-catalog-card">
        <div class="public-catalog-image">
          ${item.imagenUrl ? `<img src="${escapeHtml(item.imagenUrl)}" alt="${escapeHtml(item.nombre)}" loading="lazy">` : '<div class="public-catalog-no-image">AM3D</div>'}
        </div>
        <div class="public-catalog-card-body">
          <div class="public-catalog-code">${escapeHtml(item.codigo || '')}</div>
          <h2>${escapeHtml(item.nombre || 'Trabajo')}</h2>
          <p>${escapeHtml(item.descripcion || 'Trabajo de impresión 3D.')}</p>
          ${Array.isArray(item.colores)&&item.colores.length?'<div class="public-catalog-colors" aria-label="Colores disponibles">'+item.colores.map(color=>'<span>'+escapeHtml(color)+'</span>').join('')+'</div>':''}
          ${item.otrosColoresPedido?'<p class="public-catalog-other-colors">Otros colores disponibles a pedido</p>':''}
          <strong class="public-catalog-price">${money(item.precioVenta)}</strong>
        </div>
      </article>`).join('') : '<p class="public-catalog-empty">No hay productos o trabajos publicados que coincidan con la búsqueda.</p>';
    grid.querySelectorAll('.public-catalog-image img').forEach(image => image.addEventListener('error', () => {
      const frame = image.closest('.public-catalog-image');
      if (frame) frame.innerHTML = '<div class="public-catalog-no-image">Imagen no disponible</div>';
    }, { once: true }));
  };
  search.addEventListener('input', render);
  onSnapshot(collection(db, 'catalogo_publico'), snapshot => {
    records = snapshot.docs.map(item => ({ id: item.id, ...item.data() }))
      .sort((a, b) => String(a.nombre || '').localeCompare(String(b.nombre || ''), 'es'));
    render();
  }, error => {
    console.error('Error de lectura Firestore en catalogo_publico:', {
      code: error.code, message: error.message, projectId: db.app?.options?.projectId,
    });
    count.textContent = 'Error de conexión';
    const permissionDenied = error.code === 'permission-denied';
    const explanation = permissionDenied
      ? 'Firestore rechazó la lectura pública. En Firebase Console → Firestore Database → Reglas, publica una regla que permita read en /catalogo_publico/{trabajoId}.'
      : 'No se pudo completar la lectura desde Firestore. Comprueba la conexión, el proyecto Firebase configurado y la consola del navegador.';
    grid.innerHTML = `<div class="public-catalog-empty">
      <strong>No se pudo cargar el catálogo.</strong>
      <p>${escapeHtml(explanation)}</p>
      <small>Código: ${escapeHtml(error.code || 'desconocido')} · Proyecto: ${escapeHtml(db.app?.options?.projectId || 'no identificado')}</small>
    </div>`;
  });
}
