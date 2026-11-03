import { saveAppState } from '../../services/app-store.js';
import {
  UNIT_INFO,
  formatStock,
  formatUnitCost,
  stockValue,
} from '../../calculations/inventory.js';
import {
  inventoryState,
  recordPurchase,
  deletePurchase,
  setMaterialStock,
  deleteMaterial,
  getInventorySummary,
} from '../../services/inventory-store.js';

const money = value => 'Bs ' + Number(value || 0).toLocaleString('es-BO', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

function dateInput(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderMaterials() {
  const materials = inventoryState.materials;
  if (!materials.length) {
    return '<div class="inventory-empty"><strong>Inventario vacío</strong><span>Registra una compra de filamento, resina o insumos para comenzar.</span></div>';
  }

  return `<div class="inventory-table-wrap"><table class="inventory-table">
    <thead><tr><th>Material</th><th>Categoría</th><th>Stock</th><th>Costo promedio</th><th>Valor en stock</th><th></th></tr></thead>
    <tbody>${materials.map(item => {
      const lowLimit = item.unidad === 'g' || item.unidad === 'ml' ? 200 : 2;
      const low = item.stock < lowLimit;
      const unit = item.unidad === 'g' ? '/kg' : item.unidad === 'ml' ? '/L' : '/u';
      return `<tr>
        <td><strong>${escapeText(item.nombre)}</strong></td>
        <td><span class="inventory-category">${escapeText(item.categoria)}</span></td>
        <td><span class="${low ? 'inventory-low' : ''}">${formatStock(item)}</span></td>
        <td>${money(formatUnitCost(item))}${unit}</td>
        <td>${money(stockValue(item))}</td>
        <td><div class="inventory-actions">
          <button type="button" data-adjust="${item.id}">Ajustar</button>
          <button type="button" class="danger" data-remove-material="${item.id}">Eliminar</button>
        </div></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderPurchases() {
  const purchases = [...inventoryState.purchases].sort((a, b) => b.fecha - a.fecha);
  if (!purchases.length) {
    return '<div class="inventory-empty"><strong>Sin compras registradas</strong><span>El historial aparecerá aquí después de guardar la primera compra.</span></div>';
  }
  return `<div class="inventory-table-wrap"><table class="inventory-table">
    <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Comprado por</th><th>Proveedor</th><th>Cantidad</th><th>Total</th><th></th></tr></thead>
    <tbody>${purchases.map(item => `<tr>
      <td>${new Date(item.fecha).toLocaleDateString('es-BO')}</td>
      <td>${escapeText(item.categoria)}</td>
      <td><strong>${escapeText(item.nombre)}</strong></td>
      <td>${escapeText(item.compradoPor || '—')}</td>
      <td>${escapeText(item.proveedor || '—')}</td>
      <td>${item.cantidad} ${UNIT_INFO[item.unidad]?.label || ''}</td>
      <td>${money(item.precioTotal)}</td>
      <td><button type="button" class="inventory-icon-danger" data-remove-purchase="${item.id}" aria-label="Eliminar compra">×</button></td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

function renderJobMovements() {
  const movements = [...inventoryState.jobMovements].sort((a, b) => b.fecha - a.fecha);
  if (!movements.length) {
    return '<div class="inventory-empty"><strong>Sin consumos registrados</strong><span>Los descuentos de material asociados a trabajos aparecerán aquí.</span></div>';
  }
  return `<div class="inventory-table-wrap"><table class="inventory-table">
    <thead><tr><th>Fecha</th><th>Trabajo</th><th>Material</th><th>Consumo</th><th>Costo aplicado</th></tr></thead>
    <tbody>${movements.map(item => `<tr>
      <td>${new Date(item.fecha).toLocaleDateString('es-BO')}</td>
      <td><strong>${escapeText(item.jobNombre || item.jobId)}</strong></td>
      <td>${escapeText(item.materialNombre)}</td>
      <td>${Number(item.grams).toLocaleString('es-BO')} g</td>
      <td>${money(item.costoTotal)}</td>
    </tr>`).join('')}</tbody>
  </table></div>`;
}

export function renderInventoryView(container) {
  container.innerHTML = `
    <section class="inventory-module">
      <div class="inventory-intro">
        <div><p class="eyebrow">ALMACÉN Y ABASTECIMIENTO</p><h2>Inventario y compras</h2>
        <p>Control de materiales consumibles, equipos, existencias y costo promedio ponderado.</p></div>
        <span class="inventory-local-tag">Datos locales · sin sincronización</span>
      </div>

      <div class="inventory-stats" id="inventoryStats"></div>

      <div class="inventory-layout">
        <form class="inventory-card" id="purchaseForm">
          <div class="inventory-card-heading"><div><p class="eyebrow">ABASTECIMIENTO</p><h3>Registrar compra</h3></div><span>01</span></div>
          <div class="inventory-form-grid">
            <label class="inventory-field"><span>Categoría</span>
              <select name="category">
                <option value="Filamento">Filamento</option>
                <option value="Resina">Resina</option>
                <option value="Insumo">Insumo / otro consumible</option>
                <option value="Equipo">Equipo / herramienta</option>
              </select>
            </label>
            <label class="inventory-field"><span>Nombre del material o equipo *</span><input name="name" required list="inventoryMaterialNames" placeholder="Ej. PLA Rojo 1.75 mm"><datalist id="inventoryMaterialNames"></datalist></label>
            <label class="inventory-field"><span>Cantidad comprada *</span><input name="quantity" type="number" min="0.01" step="any" required placeholder="1000"></label>
            <label class="inventory-field"><span>Unidad *</span>
              <select name="unit">
                <option value="g">Gramos (g)</option><option value="kg">Kilogramos (kg)</option>
                <option value="ml">Mililitros (ml)</option><option value="l">Litros (L)</option>
                <option value="unidad">Unidades / piezas</option>
              </select>
            </label>
            <label class="inventory-field"><span>Precio total pagado (Bs) *</span><input name="totalPrice" type="number" min="0.01" step="any" required placeholder="95"></label>
            <label class="inventory-field"><span>Comprado por</span><input name="purchasedBy" placeholder="Nombre"></label>
            <label class="inventory-field"><span>Proveedor</span><input name="supplier" placeholder="Nombre del proveedor"></label>
            <label class="inventory-field"><span>Fecha</span><input name="date" type="date" required></label>
            <label class="inventory-field inventory-span-2"><span>Notas</span><textarea name="notes" rows="2" placeholder="Detalles de la compra"></textarea></label>
          </div>
          <button class="inventory-primary" type="submit">Guardar compra</button>
          <p class="inventory-help">Los equipos quedan en el historial de compras, pero no incrementan el stock consumible.</p>
        </form>

        <section class="inventory-card">
          <div class="inventory-card-heading"><div><p class="eyebrow">EXISTENCIAS</p><h3>Inventario de materiales</h3></div><span id="inventoryMaterialCount">0</span></div>
          <div id="inventoryMaterials"></div>
          <p class="inventory-help">El costo promedio se expresa por gramo, mililitro o unidad base. Para filamento se muestra también el equivalente por kilogramo.</p>
        </section>
      </div>

      <section class="inventory-card inventory-history">
        <div class="inventory-card-heading"><div><p class="eyebrow">MOVIMIENTOS DE COMPRA</p><h3>Historial de compras</h3></div><span id="inventoryPurchaseCount">0</span></div>
        <div id="inventoryPurchases"></div>
      </section>
      <section class="inventory-card inventory-history">
        <div class="inventory-card-heading"><div><p class="eyebrow">PRODUCCIÓN</p><h3>Consumo por trabajos</h3></div><span id="inventoryMovementCount">0</span></div>
        <div id="inventoryJobMovements"></div>
      </section>
      <p class="inventory-warning">Importante: eliminar una compra del historial no revierte el stock, igual que en 3DBoys. Ajusta el inventario por separado si necesitas corregir existencias.</p>
    </section>
  `;

  const form = container.querySelector('#purchaseForm');
  const materialsRoot = container.querySelector('#inventoryMaterials');
  const purchasesRoot = container.querySelector('#inventoryPurchases');
  const statsRoot = container.querySelector('#inventoryStats');
  const movementsRoot = container.querySelector('#inventoryJobMovements');

  function refresh() {
    const summary = getInventorySummary();
    statsRoot.innerHTML = `
      <article><span>INVERSIÓN REGISTRADA</span><strong>${money(summary.totalSpent)}</strong></article>
      <article><span>COMPRAS ESTE MES</span><strong>${money(summary.monthSpent)}</strong></article>
      <article><span>VALOR DEL INVENTARIO</span><strong>${money(summary.stockValue)}</strong></article>
      <article><span>INVERSIÓN EN EQUIPOS</span><strong>${money(summary.equipmentSpent)}</strong></article>
      <article><span>CONSUMO EN TRABAJOS</span><strong>${money(summary.jobConsumption)}</strong></article>`;
    materialsRoot.innerHTML = renderMaterials();
    purchasesRoot.innerHTML = renderPurchases();
    movementsRoot.innerHTML = renderJobMovements();
    container.querySelector('#inventoryMaterialCount').textContent = inventoryState.materials.length + ' materiales';
    container.querySelector('#inventoryPurchaseCount').textContent = inventoryState.purchases.length + ' compras';
    container.querySelector('#inventoryMovementCount').textContent = inventoryState.jobMovements.length + ' consumos';
    window.dispatchEvent(new Event('inventory:updated'));

    const names = [...new Set(inventoryState.materials.map(item => item.nombre))];
    container.querySelector('#inventoryMaterialNames').innerHTML = names.map(name => `<option value="${escapeText(name)}"></option>`).join('');
  }

  form.elements.date.value = dateInput(Date.now());
  form.elements.category.addEventListener('change', () => {
    const defaults = { Filamento: 'g', Resina: 'ml', Insumo: 'unidad', Equipo: 'unidad' };
    form.elements.unit.value = defaults[form.elements.category.value] || 'unidad';
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    try {
      recordPurchase({
        ...data,
        date: data.date ? new Date(data.date + 'T12:00:00').getTime() : Date.now(),
      });
      saveAppState();
      form.reset();
      form.elements.date.value = dateInput(Date.now());
      const defaults = { Filamento: 'g', Resina: 'ml', Insumo: 'unidad', Equipo: 'unidad' };
      form.elements.unit.value = defaults[form.elements.category.value] || 'unidad';
      refresh();
    } catch (error) {
      window.alert(error.message);
    }
  });

  materialsRoot.addEventListener('click', event => {
    const adjust = event.target.closest('[data-adjust]');
    const remove = event.target.closest('[data-remove-material]');
    if (adjust) {
      const material = inventoryState.materials.find(item => item.id === adjust.dataset.adjust);
      if (!material) return;
      const label = material.unidad === 'g' ? 'gramos' : material.unidad === 'ml' ? 'mililitros' : 'unidades';
      const value = window.prompt(`Nuevo stock de ${material.nombre} (${label}):`, material.stock);
      if (value === null) return;
      try { setMaterialStock(material.id, value); saveAppState(); refresh(); }
      catch (error) { window.alert(error.message); }
    }
    if (remove) {
      const material = inventoryState.materials.find(item => item.id === remove.dataset.removeMaterial);
      if (!material || !window.confirm(`¿Eliminar ${material.nombre} del inventario? El historial de compras se conservará.`)) return;
      try { deleteMaterial(material.id); saveAppState(); refresh(); }
      catch (error) { window.alert(error.message); }
    }
  });

  purchasesRoot.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-purchase]');
    if (!remove) return;
    if (!window.confirm('¿Eliminar esta compra del historial? El stock NO se modificará.')) return;
    deletePurchase(remove.dataset.removePurchase);
    saveAppState();
    refresh();
  });

  refresh();
}
