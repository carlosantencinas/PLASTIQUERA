import JsBarcode from 'jsbarcode';
import { uploadProductImage } from '../../services/product-images.js';
import { appState, saveAppState, exportBackup, importBackup, makeId, DEFAULT_SETTINGS } from '../../services/app-store.js';
import { inventoryState, applyProductionBatchMaterials, reverseProductionBatchMaterials } from '../../services/inventory-store.js';
import { getProductStock, getJobSellableQuantity, assertJobCanSell, assertJobVariantCanSell, assertProductCanMove, consignmentBalance, positiveInteger, assertVariantCanMove, getProductVariantStock, assertProductionBatchCanReverse, createProductionBatch, reverseProductionBatch } from '../../calculations/commerce.js';
import { isProductCodeAvailable, validateVariantInput, getProductVariants } from '../../calculations/product-variants.js';
import { getProductionBatchMaterialConsumptions } from '../../calculations/production-consumption.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => 'Bs ' + Number(value || 0).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateText = value => value ? new Date(value).toLocaleDateString('es-BO') : '—';
const dateValue = value => { const d = value ? new Date(value) : new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const pieces = job => getJobSellableQuantity(job);
const jobIdsFor = productId => appState.jobs.filter(j => j.data?.productoId === productId);
const stockFor = productId => getProductStock(productId, appState.jobs, appState.sales, appState.consignments);
const availableFor = productId => stockFor(productId).available;
const getProduct = id => appState.products.find(p => p.id === id);
const getJob = id => appState.jobs.find(j => j.id === id);
const findClientByName = (name, type) => { const key=String(name||'').trim().toLocaleLowerCase('es'); const matches=appState.clients.filter(client=>String(client.nombre||'').trim().toLocaleLowerCase('es')===key&&(!type||client.tipo===type)); return matches.length===1?matches[0]:null; };
const notify = message => { const node=document.querySelector('#management-message'); if(node){node.textContent=message;node.hidden=false;setTimeout(()=>node.hidden=true,2600);} };
async function requestProductionBatchOptions(job, consumptions) {
  const materials=inventoryState.materials.filter(item=>item.categoria==='Filamento'&&item.unidad==='g');
  const rows=consumptions.map((row,index)=>{
    const original=inventoryState.materials.find(item=>item.id===row.materialId);
    return `<div class="batch-change-row"><label><input type="checkbox" data-change-material="${index}"> Cambiar ${esc(original?.nombre||'material')} (${row.grams.toFixed(1)} g)</label><select data-material-choice="${index}" disabled><option value="">Selecciona filamento</option>${materials.map(item=>`<option value="${esc(item.id)}" ${item.id===row.materialId?'selected':''}>${esc(item.nombre)} · ${Number(item.stock||0).toFixed(1)} g</option>`).join('')}</select></div>`;
  }).join('');
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');
    dialog.className='production-batch-dialog';
    dialog.innerHTML=`<form method="dialog" class="production-batch-form">
      <div class="production-batch-head"><p class="eyebrow">PRODUCCIÓN</p><h3>Registrar reimpresión</h3><p>La receta original se conserva automáticamente. Marca solamente los cambios que deseas realizar.</p></div>
      <label class="batch-change-toggle"><input type="checkbox" id="batch-quantity-change"> Modificar cantidades</label>
      <div class="batch-quantity-fields" hidden><label>Piezas producidas<input name="produced" type="number" min="1" step="1" value="1" required></label><label>Piezas fallidas<input name="failed" type="number" min="0" step="1" value="0" required></label></div>
      <label class="batch-change-toggle"><input type="checkbox" id="batch-material-change"> Cambiar material o color</label>
      <div class="batch-material-fields" hidden>${rows||'<p>No hay materiales para modificar.</p>'}</div>
      <div class="production-batch-actions"><button type="button" class="management-button secondary" data-batch-cancel>Cancelar</button><button type="submit" class="management-button">Registrar reimpresión</button></div>
    </form>`;
    const quantityToggle=dialog.querySelector('#batch-quantity-change');
    const materialToggle=dialog.querySelector('#batch-material-change');
    quantityToggle.addEventListener('change',()=>{dialog.querySelector('.batch-quantity-fields').hidden=!quantityToggle.checked;dialog.querySelectorAll('.batch-quantity-fields input').forEach(input=>input.disabled=!quantityToggle.checked);});
    materialToggle.addEventListener('change',()=>{dialog.querySelector('.batch-material-fields').hidden=!materialToggle.checked;});
    dialog.querySelectorAll('[data-change-material]').forEach(check=>{
      check.addEventListener('change',()=>{dialog.querySelector('[data-material-choice="'+check.dataset.changeMaterial+'"]').disabled=!check.checked;});
    });
    let settled=false;
    const finish=value=>{if(settled)return;settled=true;dialog.close();dialog.remove();resolve(value);};
    dialog.querySelector('[data-batch-cancel]').addEventListener('click',()=>finish(null));
    dialog.addEventListener('cancel',event=>{event.preventDefault();finish(null);});
    dialog.addEventListener('close',()=>finish(null));
    dialog.addEventListener('submit',event=>{
      event.preventDefault();
      const produced=quantityToggle.checked?Number(dialog.querySelector('[name="produced"]').value):1;
      const failed=quantityToggle.checked?Number(dialog.querySelector('[name="failed"]').value):0;
      if(!Number.isSafeInteger(produced)||produced<=0||!Number.isSafeInteger(failed)||failed<0||failed>produced){alert('Revisa las cantidades: las piezas fallidas deben estar entre cero y las producidas.');return;}
      const revised=consumptions.map((row,index)=>{
        const check=dialog.querySelector('[data-change-material="'+index+'"]');
        const select=dialog.querySelector('[data-material-choice="'+index+'"]');
        return check?.checked?{...row,materialId:select.value}:row;
      });
      if(revised.some(row=>!row.materialId)){alert('Selecciona el nuevo filamento para cada cambio marcado.');return;}
      finish({produced,failed,consumptions:revised,quantityChanged:quantityToggle.checked});
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

function createVariantForBatch(product, materialIds) {
  if(!product)return null;
  const ids=[...new Set(materialIds)].sort();
  const existing=getProductVariants(product).find(variant=>Array.isArray(variant.materialIds)&&[...variant.materialIds].sort().join('|')===ids.join('|'));
  if(existing)return existing;
  const names=ids.map(id=>inventoryState.materials.find(item=>item.id===id)?.nombre||'Filamento').join(' + ');
  const suffix=names.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,18)||'COLOR';
  const base=String(product.codigo)+'-'+suffix;
  let code=base,index=2;
  while(!isProductCodeAvailable(code,appState.products))code=base+'-'+index++;
  const values=validateVariantInput({code,name:names},appState.products);
  const variant={id:makeId('var'),...values,materialIds:ids,activo:true,createdAt:Date.now(),source:'production-batch'};
  if(!Array.isArray(product.variantes))product.variantes=[];
  product.variantes.push(variant);
  return variant;
}

let active = 'dashboard';
let pendingSaleProductId = null;
let pendingSaleJobId = null;

function shell(section) {
  const titles = {dashboard:'Panel principal',products:'Productos',clients:'Clientes',sales:'Ventas',consignments:'Consignaciones',finance:'Finanzas',settings:'Configuración'};
  return `
  <section class="management-module">
    <div class="management-heading"><div><p class="eyebrow">GESTIÓN COMERCIAL</p><h2>${titles[section]}</h2><p>${section==='products'?'Productos terminados, existencias listas para vender y asignación de trabajos.':section==='dashboard'?'Resumen de producción, ventas y operación del taller.':'Registros relacionados con la producción, los clientes y la venta de productos.'}</p></div><span class="local-data-tag">Datos guardados en Firebase</span></div>
    <div id="management-message" class="management-message" hidden role="status"></div>
    ${section==='dashboard'?dashboard():section==='products'?products():section==='clients'?clients():section==='sales'?sales():section==='finance'?finance():section==='settings'?settings():consignments()}
    <section class="backup-panel"><div><strong>Respaldo de datos</strong><p>Exporta periódicamente un archivo JSON. La importación reemplaza los datos actuales de Firebase.</p></div><div class="backup-actions"><button type="button" class="management-button secondary" id="backup-export">Exportar respaldo</button><label class="management-button secondary file-button">Importar respaldo<input type="file" id="backup-import" accept=".json,application/json" hidden></label></div></section>
  </section>`;
}


function settings() {
  const s = { ...DEFAULT_SETTINGS, ...(appState.settings || {}) };
  const field = (name, label, unit, help='') => `
    <label class="management-field">${label} (${unit})
      <input name="${name}" type="number" min="0" step="any" value="${esc(s[name])}" required>
      ${help ? `<small class="settings-help">${help}</small>` : ''}
    </label>`;
  return `
    <form class="management-card settings-form" id="settings-form">
      <div class="settings-intro"><h3>Parámetros automáticos de costos</h3><p class="management-help">Se aplican como valores predeterminados al crear un trabajo nuevo. No alteran los costos ni los precios históricos ya guardados.</p></div>
      <div class="management-grid settings-grid">
        ${field('precioKwh','Costo de energía eléctrica','Bs/kWh','Tarifa usada para estimar el costo de impresión.')}
        ${field('potenciaW','Potencia predeterminada de impresora','W','Potencia de referencia para el cálculo energético.')}
        ${field('mantenimientoHora','Mantenimiento de impresora','Bs/hora')}
        ${field('tarifaHora','Mano de obra','Bs/hora')}
        ${field('horasTrabajo','Tiempo predeterminado de mano de obra','horas')}
        ${field('fallas','Reserva por fallas','%')}
        ${field('margen','Margen de ganancia','%')}
        ${field('precioFilamentoKg','Costo manual de filamento','Bs/kg','Se usa cuando el trabajo no está vinculado a una bobina del inventario.')}
      </div>
      <div class="management-actions"><button class="management-button" type="submit">Guardar configuración</button><button class="management-button secondary" type="button" id="settings-reset">Restablecer valores iniciales</button></div>
      <p class="management-help">Moneda: bolivianos (Bs). Los parámetros se guardan en Firestore y se comparten entre los dispositivos que acceden a esta cuenta de taller.</p>
    </form>`;
}
function attachSettings(root) {
  const form = root.querySelector('#settings-form');
  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const next = {};
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      const value = Number(data[key]);
      if (!Number.isFinite(value) || value < 0) { alert('Revisa los parámetros: todos deben ser números iguales o mayores que cero.'); return; }
      next[key] = value;
    }
    appState.settings = next;
    saveAppState();
    renderManagementView(root, 'settings');
    notify('Configuración guardada.');
  });
  root.querySelector('#settings-reset').addEventListener('click', () => {
    if (!confirm('¿Restablecer los parámetros iniciales?')) return;
    appState.settings = { ...DEFAULT_SETTINGS };
    saveAppState();
    renderManagementView(root, 'settings');
    notify('Parámetros iniciales restaurados.');
  });
}

function dashboard() {
  const completedJobs=appState.jobs.filter(job=>!job.data?.estadoTrabajo||job.data.estadoTrabajo==='realizado');
  const totalJobs=appState.jobs.length;
  const totalSales=appState.sales.reduce((n,s)=>n+Number(s.monto||0),0);
  const pending=appState.consignments.reduce((n,item)=>n+consignmentBalance(item).pending,0);
  const sellable=appState.jobs.reduce((n,j)=>n+pieces(j),0);
  const printerHours=completedJobs.reduce((sum,job)=>sum+Math.max(0,Number(job.data?.horasImpresion||0)),0);
  const usedGrams=inventoryState.jobMovements
    .filter(movement=>completedJobs.some(job=>job.id===movement.jobId))
    .reduce((sum,movement)=>sum+Math.max(0,Number(movement.grams||0)),0);
  const formatDuration=hours=>{
    const totalMinutes=Math.round(hours*60);
    const days=Math.floor(totalMinutes/1440);
    const h=Math.floor((totalMinutes%1440)/60);
    const mins=totalMinutes%60;
    return [days?days+' d':'',h? h+' h':'',mins?mins+' min':''].filter(Boolean).join(' ')||'0 min';
  };
  const filamentRows=inventoryState.materials
    .filter(item=>item.categoria==='Filamento'&&String(item.unidad).toLowerCase()==='g')
    .sort((a,b)=>String(a.nombre).localeCompare(String(b.nombre),'es'))
    .map(item=>{
      const color=/^#[0-9a-f]{6}$/i.test(String(item.colorHex||''))?item.colorHex:'#c5c9d1';
      const hex=color.slice(1);
      const channels=[0,2,4].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
      const luminance=0.2126*channels[0]+0.7152*channels[1]+0.0722*channels[2];
      const textColor=luminance>0.42?'#171717':'#ffffff';
      const typeMatch=String(item.nombre).toUpperCase().match(/\\b(PETG|PLA|TPU|ABS|ASA|PVA|HIPS|PC|NYLON|PA|PET|PLA\\+|PETG\\+)\\b/);
      return {
        name:item.nombre,
        type:typeMatch?.[0]||String(item.nombre).trim().toUpperCase(),
        color,textColor,
        stock:Math.max(0,Number(item.stock||0)),
      };
    });
  return `<div class="management-stats dashboard-production-stats">
    <article><span>TRABAJOS TOTALES</span><strong>${totalJobs}</strong><small>${completedJobs.length} realizados</small></article>
    <article><span>TIEMPO DE IMPRESIÓN</span><strong>${formatDuration(printerHours)}</strong><small>Acumulado de trabajos realizados</small></article>
    <article><span>FILAMENTO UTILIZADO</span><strong>${usedGrams.toLocaleString('es-BO',{maximumFractionDigits:1})} g</strong><small>Consumo registrado en inventario</small></article>
    <article><span>PIEZAS PRODUCIDAS</span><strong>${completedJobs.reduce((sum,job)=>sum+pieces(job),0)}</strong><small>Unidades de trabajos realizados</small></article>
    <article><span>VENTAS REGISTRADAS</span><strong>${money(totalSales)}</strong><small>${appState.sales.length} operaciones</small></article>
  </div>
  <div class="management-card dashboard-filament-card">
    <div class="dashboard-section-heading"><div><p class="eyebrow">MATERIALES</p><h3>Filamento restante por color</h3></div><span>${filamentRows.length} materiales</span></div>
    ${filamentRows.length?`<div class="dashboard-filament-list">${filamentRows.map(item=>`
      <div class="dashboard-filament-tile" style="--tile-color:${item.color};--tile-text:${item.textColor}">
        <span class="dashboard-filament-type">${esc(item.type)}</span>
        <strong class="dashboard-filament-stock">${item.stock.toLocaleString('es-BO',{maximumFractionDigits:1})}<small>g</small></strong>
        <span class="dashboard-filament-material-name">${esc(item.name)}</span>
      </div>`).join('')}</div>`:'<p class="management-empty">No hay filamentos registrados en inventario. Registra compras de filamento para visualizar existencias por color.</p>'}
  </div>
  <div class="management-card"><h3>Resumen de operación</h3><div class="management-summary-grid">
    <div><span>Piezas vendibles registradas</span><b>${sellable}</b></div>
    <div><span>Clientes y tiendas</span><b>${appState.clients.length}</b></div>
    <div><span>Ventas registradas</span><b>${appState.sales.length}</b></div>
    <div><span>Entregas en consignación</span><b>${appState.consignments.length}</b></div>
    <div><span>Por cobrar en consignación</span><b>${money(pending)}</b></div>
  </div><p class="management-help">El tiempo se calcula con las horas de impresión registradas en cada trabajo realizado. El filamento utilizado se obtiene de los movimientos de consumo del inventario; los trabajos antiguos sin movimientos registrados no se estiman.</p></div>`;
}

function products() {
  return `<section class="management-card product-catalog-card catalog-operations-card">
    <div class="product-catalog-heading"><div><p class="eyebrow">CATÁLOGO AM3D</p><h3>Catálogo y producción</h3><p>Productos, trabajos, códigos, cantidades, ventas y reimpresiones en una sola tabla.</p></div><button type="button" class="management-button" id="catalog-add-product">+ Nuevo producto</button></div>
    <div class="catalog-filter-toolbar">
      <label class="catalog-filter-search"><span>Buscar</span><input class="management-search" id="product-search" type="search" placeholder="Producto, código, trabajo o cliente…"></label>
      <label><span>Desde</span><input id="catalog-date-from" type="date"></label><label><span>Hasta</span><input id="catalog-date-to" type="date"></label>
      <label><span>Tipo</span><select id="catalog-type-filter"><option value="">Todos los tipos</option>${PRODUCT_TYPES.map(([code,label])=>`<option value="${esc(code)}">${esc(label)}</option>`).join('')}</select></label>
      <label><span>Estado</span><select id="catalog-status-filter"><option value="">Todos los estados</option><option value="cotizacion">Cotización</option><option value="pendiente">Pendiente</option><option value="realizado">Realizado</option></select></label>
      <label><span>Cliente</span><input id="catalog-client-filter" type="search" placeholder="Nombre del cliente"></label>
      <button type="button" class="management-button secondary" id="catalog-clear-filters">Limpiar filtros</button>
    </div>
    <div id="products-table" class="catalog-unified-table"></div>
  </section>`;
}
function clients() {
  return `<div class="management-grid">
    <form class="management-card" id="client-form"><h3 id="client-form-title">Nuevo cliente o tienda</h3><input type="hidden" name="id">
      <label class="management-field">Tipo<select name="tipo"><option>Cliente</option><option>Tienda</option></select></label>
      <label class="management-field">Nombre<input name="nombre" required></label>
      <label class="management-field">Teléfono<input name="telefono"></label>
      <label class="management-field">Contacto adicional<input name="contacto"></label>
      <label class="management-field">Dirección<input name="direccion"></label>
      <label class="management-field">Notas<textarea name="notas" rows="3"></textarea></label>
      <div class="management-actions"><button class="management-button" type="submit">Guardar</button><button class="management-button secondary" type="reset">Limpiar</button></div>
    </form>
    <div class="management-card"><h3>Directorio</h3><input class="management-search" id="client-search" placeholder="Buscar por nombre, teléfono o notas"><div id="clients-table" class="management-table-wrap"></div><div id="client-history" class="client-history" hidden></div></div>
  </div>`;
}

function sales() {
  return `<div class="management-grid">
    <form class="management-card" id="sale-form"><h3>Registrar venta</h3>
      <label class="management-field">Trabajo asociado<select name="jobId" id="sale-job"><option value="">Venta independiente / sin trabajo</option>${appState.jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.data.nombre)} — ${money(j.calc?.precioUnitario || j.calc?.precioVenta)}</option>`).join('')}</select></label>
      <label class="management-field">Producto (opcional)<select name="productoId" id="sale-product"><option value="">Sin producto</option>${appState.products.map(p=>`<option value="${esc(p.id)}" ${pendingSaleProductId===p.id?'selected':''}>${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}</select></label>
      <label class="management-field">Variante<select name="variantId" id="sale-variant"><option value="">Selecciona producto primero</option></select></label>
      <label class="management-field">Cliente<input name="cliente" list="management-clients" placeholder="Nombre del cliente"><datalist id="management-clients">${appState.clients.map(c=>`<option value="${esc(c.nombre)}"></option>`).join('')}</datalist></label>
      <div class="management-form-row"><label class="management-field">Cantidad<input name="cantidad" type="number" min="1" step="1" value="1" required></label><label class="management-field">Monto (Bs)<input name="monto" type="number" min="0.01" step="0.01" required></label></div>
      <div class="management-form-row"><label class="management-field">Fecha<input name="fecha" type="date" value="${dateValue()}"></label><label class="management-field">Método de pago<select name="metodoPago"><option>Efectivo</option><option>QR</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label></div>
      <label class="management-field">Vendido por<input name="vendidoPor"></label><label class="management-field">Notas<textarea name="notas" rows="2"></textarea></label>
      <button class="management-button" type="submit">Guardar venta</button><p class="management-help" id="sale-stock-help">Al asociar un trabajo se validan las piezas restantes y se descuenta la cantidad vendida del stock disponible.</p>
    </form>
    <div class="management-card sales-history-card"><h3>Historial de ventas</h3><div id="sales-summary" class="sales-summary"></div><div class="management-table-wrap" id="sales-table"></div><div class="management-actions"><button class="management-button secondary" id="sales-print">Imprimir reporte</button><button class="management-button secondary" id="sales-csv">Exportar CSV</button></div></div>
  </div>`;
}

function consignments() {
  return `<div class="management-grid">
    <form class="management-card" id="consignment-form"><h3>Registrar entrega a tienda</h3>
      <label class="management-field">Tienda<input name="tienda" list="management-stores" required><datalist id="management-stores">${appState.clients.filter(c=>c.tipo==='Tienda').map(c=>`<option value="${esc(c.nombre)}"></option>`).join('')}</datalist></label>
      <label class="management-field">Contacto<input name="contacto"></label>
      <label class="management-field">Producto<select name="productoId" id="cons-product"><option value="">Producto libre / sin código</option>${appState.products.map(p=>`<option value="${esc(p.id)}">${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}</select></label>
      <label class="management-field">Variante<select name="variantId" id="cons-variant"><option value="">Selecciona producto primero</option></select></label>
      <label class="management-field">Descripción libre<input name="productoLibre" placeholder="Descripción si no hay producto"></label>
      <div class="management-form-row"><label class="management-field">Cantidad<input name="cantidad" type="number" min="1" step="1" value="1" required></label><label class="management-field">Precio por unidad (Bs)<input name="precioUnitario" type="number" min="0.01" step="0.01" required></label></div>
      <div class="management-form-row"><label class="management-field">Fecha<input name="fecha" type="date" value="${dateValue()}"></label><label class="management-field">Monto pagado (Bs)<input name="montoPagado" type="number" min="0" step="0.01" value="0" required></label></div>
      <label class="management-field">Notas<textarea name="notas" rows="2"></textarea></label>
      <button class="management-button" type="submit">Registrar entrega</button><p class="management-help" id="cons-stock-help">Las piezas entregadas dejan de estar disponibles en taller hasta que se vendan o devuelvan.</p>
    </form>
    <div class="management-card"><h3>Resumen por tienda</h3><div id="consignment-summary"></div></div>
  </div>
  <div class="management-card"><h3>Historial de consignaciones</h3><div class="management-table-wrap" id="consignments-table"></div><div class="management-actions"><button class="management-button secondary" id="cons-print">Imprimir reporte</button></div></div>`;
}

function renderSellableProductsTable(root) {
  const availableProducts = appState.products.map(product => {
    const stock = stockFor(product.id);
    const relatedJobs = jobIdsFor(product.id).sort((a,b) =>
      Number(b.updatedAt || b.createdAt || b.data?.fecha || 0) - Number(a.updatedAt || a.createdAt || a.data?.fecha || 0)
    );
    const latestJob = relatedJobs[0];
    const price = latestJob
      ? (Number(latestJob.data?.piezasVendibles ?? 1) > 1
        ? Number(latestJob.calc?.precioUnitario || 0)
        : Number(latestJob.calc?.precioVenta || 0))
      : 0;
    return { product, stock, price };
  }).filter(item => item.stock.available > 0);

  if (!availableProducts.length) {
    root.innerHTML = '<p class="management-empty">No hay productos terminados disponibles para vender. Registra trabajos y asígnalos a un producto para calcular sus existencias.</p>';
    return;
  }
  root.innerHTML = `<table class="management-table"><thead><tr><th>Código</th><th>Producto terminado</th><th>Unidades disponibles</th><th>Precio referencial</th><th>Acción</th></tr></thead><tbody>${availableProducts.map(({product,stock,price}) =>
    `<tr><td>${esc(product.codigo)}</td><td><b>${esc(product.nombre)}</b><small>${esc(product.notas || '')}</small></td><td><b>${stock.available}</b></td><td>${price > 0 ? money(price) : 'Sin precio calculado'}</td><td><button type="button" class="management-button product-quick-sale" data-sell-product="${esc(product.id)}">Vender</button></td></tr>`
  ).join('')}</tbody></table>`;
}

const PRODUCT_TYPES = [
  ['DEC','Decoración'],['FUN','Funcional y utilitario'],['REP','Repuestos y reparaciones'],
  ['PER','Personalizados'],['MIN','Miniaturas y figuras'],['ACC','Accesorios'],
  ['HOG','Hogar y organización'],['PRO','Prototipos'],
];
function nextProductCode(prefix) {
  const pattern = new RegExp('^AM3D-' + prefix + '-(\\d+)$','i');
  const max = appState.products.reduce((highest, product) => {
    const match = String(product.codigo || '').match(pattern);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return 'AM3D-' + prefix + '-' + String(max + 1).padStart(4,'0');
}
function nextVariantCode(product, name) {
  const suffix = String(name || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'VARIANTE';
  const base = String(product?.codigo || 'AM3D') + '-' + suffix;
  let code = base;
  let index = 2;
  while (!isProductCodeAvailable(code, appState.products)) code = base + '-' + index++;
  return code;
}
function renderCompletedJobs(root, query='') {
  const completed = appState.jobs.filter(job => !job.data?.estadoTrabajo || job.data.estadoTrabajo === 'realizado')
    .sort((a,b) => Number(b.createdAt || b.updatedAt || b.data?.fecha || 0) - Number(a.createdAt || a.updatedAt || a.data?.fecha || 0));
  const q=String(query||'').trim().toLocaleLowerCase('es');
  const filtered=completed.filter(job=>[job.data?.nombre,job.data?.cliente,getProduct(job.data?.productoId)?.nombre,getProduct(job.data?.productoId)?.codigo].join(' ').toLocaleLowerCase('es').includes(q));
  if (!filtered.length) {
    root.innerHTML = '<p class="management-empty">Todavía no hay trabajos realizados. Cuando marques un trabajo como realizado aparecerá aquí automáticamente.</p>';
    return;
  }
  root.innerHTML = filtered.map(job => {
    const quantity = pieces(job);
    const sold = appState.sales.filter(sale => sale.jobId === job.id).reduce((sum,sale) => sum + Number(sale.cantidad || 1),0);
    const available = Math.max(0,quantity-sold);
    const product = getProduct(job.data.productoId);
    const variants = getProductVariants(product);
    const selectedCategory = product?.tipo || 'ACC';
    const prefix = PRODUCT_TYPES.some(([code])=>code===selectedCategory) ? selectedCategory : 'ACC';
    const assignmentStatus = !product ? ['unassigned','SIN CÓDIGO ASIGNADO'] : job.data.variantId && variants.some(v=>v.id===job.data.variantId) ? ['assigned','CÓDIGO '+(variants.find(v=>v.id===job.data.variantId)?.codigo||'')] : ['partial','PRODUCTO '+product.codigo+' · '+(variants.length?'FALTA VARIANTE':'CÓDIGO ASIGNADO')];
    const status = available === 0 ? ['agotado','Agotado'] : sold > 0 ? ['parcial','Disponible parcial'] : ['available','Disponible'];
    const soldItems = appState.sales.filter(sale => sale.jobId === job.id);
    const soldDetail = soldItems.length ? soldItems.map(sale => dateText(sale.fecha)+' · '+(sale.cliente||'Sin cliente')+' · '+(sale.cantidad||1)+' pza · '+money(sale.monto)).join(' | ') : 'Sin ventas registradas';
    const batches = Array.isArray(job.data.productionBatches) ? job.data.productionBatches : [];
    return `<article class="production-job-card">
      <div class="production-job-top">
        <div class="production-job-identity"><span class="production-job-date">${dateText(job.data.fecha)}</span><h5>${esc(job.data.nombre || 'Trabajo sin nombre')}</h5><p>${esc(job.data.cliente || 'Sin cliente')}</p></div>
        <span class="production-status production-status-${assignmentStatus[0]}" title="Estado de asignación">${esc(assignmentStatus[1])}</span>
      </div>
      <div class="production-job-metrics">
        <div><small>PRODUCIDAS</small><b>${quantity}</b></div>
        <div><small>VENDIDAS</small><b>${sold}</b></div>
        <div><small>DISPONIBLES</small><b>${available}</b></div>
        <div class="production-job-stock"><div class="production-stock-bar"><i style="width:${quantity ? Math.min(100,sold/quantity*100) : 0}%"></i></div><small>Stock del trabajo</small></div>
      </div>
      <div class="production-job-link">
        <label>Producto<select data-existing-product="${esc(job.id)}">
          <option value="">Sin clasificar / asignar producto</option>${appState.products.map(p=>`<option value="${esc(p.id)}" ${product?.id===p.id?'selected':''}>${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}
        </select></label>
        <label>Variante<select data-existing-variant="${esc(job.id)}" ${!variants.length?'disabled':''}>
          <option value="">${variants.length?'Sin variante':'Este producto no tiene variantes'}</option>${variants.map(v=>'<option value="'+esc(v.id)+'" '+(job.data.variantId===v.id?'selected':'')+'>'+esc(v.nombre)+' · '+esc(v.codigo)+'</option>').join('')}
        </select></label>
        <button type="button" class="management-button production-assign-button" data-assign-existing="${esc(job.id)}">Guardar asignación</button>
      </div>
      <div class="production-job-actions">
        ${available > 0 ? `<button type="button" class="management-button product-quick-sale" data-sell-job="${esc(job.id)}">Vender unidades</button>` : ''}
        <button type="button" class="management-button secondary" data-production-batch="${esc(job.id)}">+ Registrar reimpresión</button>
        <details class="production-new-product"><summary>Crear producto nuevo desde este trabajo</summary><div class="production-new-fields">
          <input data-new-name="${esc(job.id)}" value="${esc(job.data.nombre)}" aria-label="Nombre del producto" placeholder="Nombre del producto">
          <select data-new-type="${esc(job.id)}" aria-label="Tipo de producto">${PRODUCT_TYPES.map(([code,label])=>`<option value="${code}" ${prefix===code?'selected':''}>${label}</option>`).join('')}</select>
          <input data-new-code="${esc(job.id)}" value="${nextProductCode(prefix)}" aria-label="Código del producto">
          <button type="button" class="management-button" data-create-assign="${esc(job.id)}">Crear y asignar</button>
        </div></details>
      </div>
      ${batches.length ? '<details class="production-batch-history"><summary>Historial de reimpresiones ('+batches.length+')</summary><ul>'+batches.map(batch=>{const consumed=(batch.materialConsumptions||[]).map(row=>{const material=inventoryState.materials.find(item=>item.id===row.materialId);return esc(material?.nombre||'Material histórico')+' '+Number(row.grams||0).toFixed(1)+' g';}).join(', ')||'Sin consumo detallado';return '<li><b>'+dateText(batch.date)+'</b> · '+Number(batch.producedQuantity||0)+' producidas · '+(batch.variantName?'Variante: '+esc(batch.variantName)+' · ':'')+Number(batch.failedQuantity||0)+' fallidas · '+Number(batch.sellableQuantity||0)+' vendibles · '+(batch.status==='reversed'?'Revertido':'Activo')+'<small>'+consumed+'</small>'+(batch.status==='reversed'?'':' <button type="button" class="management-link danger" data-reverse-production-batch="'+esc(job.id)+'" data-batch-id="'+esc(batch.id)+'">Revertir lote</button>')+'</li>';}).join('')+'</ul></details>' : ''}
    </article>`;
  }).join('');
}
function barcodeImageSource(code) {
  const value=String(code||'').trim();if(!value)return '';
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
  JsBarcode(svg,value,{format:'CODE128',displayValue:true,font:'Arial',fontSize:18,fontOptions:'bold',textMargin:4,margin:0,marginLeft:18,marginRight:18,height:66,width:2,lineColor:'#111111',background:'#ffffff'});
  svg.setAttribute('preserveAspectRatio','xMinYMin meet');
  svg.setAttribute('shape-rendering','crispEdges');
  return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(new XMLSerializer().serializeToString(svg));
}

function downloadBarcodeSvg(code) {
  const value=String(code||'').trim();if(!value)return;
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('xmlns',ns);
  JsBarcode(svg,value,{format:'CODE128',displayValue:true,font:'Arial',fontSize:22,fontOptions:'bold',textMargin:6,margin:0,marginLeft:22,marginRight:22,height:82,width:2.4,lineColor:'#000000',background:'#ffffff'});
  svg.setAttribute('shape-rendering','crispEdges');
  svg.setAttribute('version','1.1');
  const serialized=new XMLSerializer().serializeToString(svg);
  const blob=new Blob(['<?xml version="1.0" encoding="UTF-8"?>'+serialized],{type:'image/svg+xml;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='codigo-'+value.replace(/[^a-z0-9_-]/gi,'-')+'.svg';
  document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),3000);
}

function printProductBarcode(product, variant = null) {
  const code=String(variant?.codigo||product?.codigo||'').trim(),labelName=variant?product.nombre+' · '+variant.nombre:product?.nombre;
  if(!code){notify('Este registro no tiene un código interno.');return;}
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
  svg.setAttribute('xmlns',ns);svg.setAttribute('width','70mm');svg.setAttribute('height','40mm');svg.setAttribute('viewBox','0 0 700 400');svg.setAttribute('version','1.1');
  const textNode=(x,y,value,size,weight='normal')=>{const node=document.createElementNS(ns,'text');node.setAttribute('x',x);node.setAttribute('y',y);node.setAttribute('text-anchor','middle');node.setAttribute('font-family','Arial,sans-serif');node.setAttribute('font-size',size);node.setAttribute('font-weight',weight);node.setAttribute('fill','#111');node.textContent=value;svg.append(node);};
  const border=document.createElementNS(ns,'rect');border.setAttribute('x','12');border.setAttribute('y','12');border.setAttribute('width','676');border.setAttribute('height','376');border.setAttribute('rx','8');border.setAttribute('fill','#fff');border.setAttribute('stroke','#aaa');border.setAttribute('stroke-width','2');svg.append(border);
  textNode(350,72,String(labelName||'Producto').slice(0,60),30,'bold');
  const barcode=document.createElementNS(ns,'svg');JsBarcode(barcode,code,{format:'CODE128',displayValue:false,margin:8,height:150,width:2});
  const vb=barcode.getAttribute('viewBox');barcode.setAttribute('x','85');barcode.setAttribute('y','105');barcode.setAttribute('width','530');barcode.setAttribute('height','180');if(vb)barcode.setAttribute('viewBox',vb);barcode.setAttribute('preserveAspectRatio','xMidYMid meet');barcode.setAttribute('overflow','visible');svg.append(barcode);
  textNode(350,335,code,28,'bold');textNode(350,372,'AM3D · CODE 128 · '+(variant?'VARIANTE':'PRODUCTO'),17);
  const serialized=new XMLSerializer().serializeToString(svg),blob=new Blob(['<?xml version="1.0" encoding="UTF-8"?>'+serialized],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='etiqueta-'+code.replace(/[^a-z0-9_-]/gi,'-')+'.svg';document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),3000);
}

function renderProductsTable(root, filters = {}) {
  const state=typeof filters==='string'?{search:filters}:(filters||{});
  const q=String(state.search||'').trim().toLocaleLowerCase('es'),from=String(state.from||''),to=String(state.to||''),type=String(state.type||''),status=String(state.status||''),client=String(state.client||'').trim().toLocaleLowerCase('es');
  const hasJobFilters=Boolean(from||to||type||status||client);
  const normalize=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('es');
  const jobMatches=(job,product=null)=>{
    const date=job.data?.fecha?dateValue(job.data.fecha):'',jobStatus=job.data?.estadoTrabajo||'realizado',jobClient=normalize(job.data?.cliente||''),jobType=String(product?.tipo||job.data?.tipoProducto||job.data?.tipo||'');
    if(from&&(!date||date<from))return false;if(to&&(!date||date>to))return false;if(type&&jobType!==type)return false;if(status&&jobStatus!==status)return false;if(client&&!jobClient.includes(client))return false;
    const productText=product?normalize([product.nombre,product.codigo,product.tipo,...getProductVariants(product).flatMap(v=>[v.nombre,v.codigo])].join(' ')):'';
    const jobText=normalize([job.data?.nombre,job.data?.cliente,job.id].join(' '));
    return !q||productText.includes(q)||jobText.includes(q);
  };
  const products=appState.products.filter(p=>{
    const productText=normalize([p.nombre,p.codigo,p.tipo,...getProductVariants(p).flatMap(v=>[v.nombre,v.codigo])].join(' ')),productMatch=!q||productText.includes(q);
    const linked=appState.jobs.filter(j=>j.data?.productoId===p.id&&jobMatches(j,p));
    return hasJobFilters?linked.length>0:(productMatch||linked.length>0);
  });
  // Deduplica por ID y excluye registros que no tengan la estructura de un trabajo.
  // También reconoce los nombres alternativos de vínculo usados por versiones anteriores.
  const uniqueJobs=new Map();
  appState.jobs.forEach(job=>{
    if(job?.id&&job.data&&typeof job.data==='object'&&!Array.isArray(job.data))uniqueJobs.set(String(job.id),job);
  });
  const completed=[...uniqueJobs.values()].filter(j=>(!j.data.estadoTrabajo||j.data.estadoTrabajo==='realizado'));
  const hasValidProductLink=job=>{
    const data=job?.data||{};
    const productId=data.productoId||data.productId||data.producto?.id||job?.productoId||job?.productId;
    if(productId&&appState.products.some(product=>String(product.id)===String(productId)))return true;
    const productCode=data.codigoProducto||data.productCode||job?.codigoProducto||job?.productCode;
    if(productCode&&appState.products.some(product=>String(product.codigo||'').trim().toLocaleLowerCase('es')===String(productCode).trim().toLocaleLowerCase('es')))return true;
    return false;
  };
  const unassigned=completed.filter(job=>!hasValidProductLink(job)&&jobMatches(job,null));
  const cards=products.map(p=>{
    const st=stockFor(p.id),vs=getProductVariants(p),productBarcode=barcodeImageSource(p.codigo),linked=appState.jobs.filter(j=>j.data?.productoId===p.id&&jobMatches(j,p)),publishedJobs=linked.filter(j=>j.data?.catalogoPublicado===true).length,publishButtonLabel=linked.length>0&&publishedJobs===linked.length?'Ya publicado':publishedJobs>0?`Publicar trabajos (${publishedJobs}/${linked.length})`:'Publicar trabajos';
    const jobRows=linked.map(j=>{
      const qty=pieces(j),sold=appState.sales.filter(x=>x.jobId===j.id).reduce((n,x)=>n+Number(x.cantidad||1),0),available=Math.max(0,qty-sold),variant=vs.find(v=>v.id===j.data?.variantId),jobStatus=j.data?.estadoTrabajo||'realizado',statusLabel=jobStatus==='realizado'?'Realizado':jobStatus==='pendiente'?'Pendiente':'Cotización';
      return `<article class="catalog-dashboard-job"><div class="catalog-dashboard-job-title"><b>${esc(j.data?.nombre||p.nombre)}</b><span class="catalog-job-status status-${esc(jobStatus)}">${statusLabel}</span></div><small>${esc(j.data?.cliente||'Sin cliente')} · ${dateText(j.data?.fecha)}</small>
      <div class="catalog-dashboard-job-metrics"><span><b>${qty}</b> prod.</span><span><b>${sold}</b> vend.</span><span><b>${available}</b> disp.</span></div>
      <div class="catalog-dashboard-job-controls"><select data-existing-variant="${esc(j.id)}" ${!vs.length?'disabled':''} aria-label="Variante del trabajo"><option value="">${vs.length?'Sin variante':'Sin variantes'}</option>${vs.map(v=>`<option value="${esc(v.id)}" ${variant?.id===v.id?'selected':''}>${esc(v.codigo)} · ${esc(v.nombre)}</option>`).join('')}</select><button class="management-link" data-assign-existing="${esc(j.id)}">Guardar variante</button>${available&&jobStatus==='realizado'? `<button class="management-button" data-sell-job="${esc(j.id)}">Venta</button>`:''}${jobStatus==='realizado'? `<button class="management-button secondary" data-production-batch="${esc(j.id)}">Reimpresión</button>`:''}</div>
      <details class="catalog-dashboard-history"><summary>Historial de ventas y lotes</summary>${appState.sales.filter(x=>x.jobId===j.id).map(x=>`<p>${dateText(x.fecha)} · ${x.cantidad||1} unidades · ${money(x.monto)}</p>`).join('')}${(j.data.productionBatches||[]).map(x=>`<p>${dateText(x.date)} · ${x.producedQuantity} producidas · ${x.sellableQuantity} vendibles · ${x.status==='reversed'?'Revertida':'Activa'} ${x.status==='reversed'?'':`<button class="management-link danger" data-reverse-production-batch="${esc(j.id)}" data-batch-id="${esc(x.id)}">Revertir</button>`}</p>`).join('')}</details></article>`;
    }).join('');
    const variantRows=vs.map(v=>{
      const x=getProductVariantStock(p.id,v.id,appState.jobs,appState.sales,appState.consignments),src=barcodeImageSource(v.codigo);
      return `<div class="catalog-dashboard-variant"><span class="catalog-variant-info"><b>${esc(v.nombre)}</b><small>${esc(v.codigo)} · ${x.available} disponibles</small><img class="catalog-inline-barcode variant-barcode" src="${esc(src)}" alt="Código de barras ${esc(v.codigo)}" title="Código vectorial con número legible debajo" loading="lazy"></span><span class="catalog-barcode-actions"><button type="button" class="management-link" data-download-barcode="${esc(v.codigo)}">SVG vectorial</button><button class="management-link" data-variant-barcode="${esc(p.id)}" data-variant-id="${esc(v.id)}">Etiqueta</button></span></div>`;
    }).join('');
    const image=p.imageUrl?`<img class="catalog-dashboard-image" src="${esc(p.imageUrl)}" alt="Vista previa de ${esc(p.nombre)}" loading="lazy">`:'<div class="catalog-dashboard-image catalog-dashboard-image-empty"><span>＋</span><small>Añadir imagen</small></div>';
    return `<article class="catalog-dashboard-card"><div class="catalog-dashboard-top"><div class="catalog-dashboard-image-wrap">${image}</div><div class="catalog-dashboard-identity"><span class="catalog-row-kind">${esc(PRODUCT_TYPES.find(x=>x[0]===p.tipo)?.[1]||p.tipo||'PRODUCTO')}</span><h3>${esc(p.nombre)}</h3><code>${esc(p.codigo)}</code><small>${p.publicadoCatalogo?'Publicado en catálogo':'No publicado'} · ${money(p.precioVenta)}</small>${p.notas?`<p>${esc(p.notas)}</p>`:''}</div><div class="catalog-dashboard-stock"><b>${st.available}</b><span>Disponibles</span></div></div>
    <div class="catalog-dashboard-barcode-panel"><div><b>Código de barras</b><small>El número aparece debajo. Descarga el SVG para conservar la calidad vectorial en Illustrator.</small><button type="button" class="management-link" data-download-barcode="${esc(p.codigo)}">Descargar SVG vectorial</button></div><img class="catalog-inline-barcode product-barcode" src="${esc(productBarcode)}" alt="Código de barras ${esc(p.codigo)}" title="Código vectorial con número legible debajo"></div>
    <div class="catalog-dashboard-kpis"><div><small>Producidas</small><b>${st.produced}</b></div><div><small>Vendidas</small><b>${st.sold}</b></div><div><small>Variantes</small><b>${vs.length}</b></div><div><small>Trabajos</small><b>${linked.length}</b></div></div>
    <div class="catalog-dashboard-actions"><button class="management-button ${publishedJobs>0?'catalog-published':''}" data-product-toggle-catalog="${esc(p.id)}">${publishButtonLabel}</button><button class="management-link" data-product-barcode="${esc(p.id)}">Etiqueta</button><button class="management-link" data-product-edit="${esc(p.id)}">Editar</button><button class="management-link" data-variant-add="${esc(p.id)}">+ Variante</button><button class="management-link danger" data-product-delete="${esc(p.id)}">Eliminar</button></div>
    <details class="catalog-dashboard-details"><summary>Variantes y códigos (${vs.length})</summary><div class="catalog-dashboard-variants">${variantRows||'<p class="management-empty">Todavía no hay variantes.</p>'}</div></details>
    ${jobRows?`<details class="catalog-dashboard-details" open><summary>Trabajos asociados (${linked.length})</summary><div class="catalog-dashboard-jobs">${jobRows}</div></details>`:'<p class="catalog-dashboard-no-jobs">Todavía no hay trabajos asociados.</p>'}</article>`;
  }).join('');
  const loose=unassigned.map(j=>`<article class="catalog-unassigned-card"><div><span class="catalog-row-kind">TRABAJO SIN PRODUCTO</span><b>${esc(j.data?.nombre||'Trabajo')}</b><small>${esc(j.data?.cliente||'Sin cliente')} · ${dateText(j.data?.fecha)}</small></div><div class="catalog-quantities"><b>${pieces(j)}</b> piezas vendibles</div><div class="catalog-assignment-controls"><select data-existing-product="${esc(j.id)}"><option value="">Asignar a producto…</option>${appState.products.map(p=>`<option value="${esc(p.id)}">${esc(p.codigo)} · ${esc(p.nombre)}</option>`).join('')}</select><button class="management-link" data-assign-existing="${esc(j.id)}">Guardar</button></div><details class="catalog-create-product"><summary>Crear producto desde trabajo</summary><div class="production-new-fields"><input data-new-name="${esc(j.id)}" value="${esc(j.data?.nombre||'')}" aria-label="Nombre del producto"><select data-new-type="${esc(j.id)}">${PRODUCT_TYPES.map(([code,label])=>`<option value="${code}">${esc(label)}</option>`).join('')}</select><input data-new-code="${esc(j.id)}" value="${nextProductCode('ACC')}" aria-label="Código del producto"><button class="management-button" data-create-assign="${esc(j.id)}">Crear y asignar</button></div></details></article>`).join('');
  root.innerHTML=`<div class="catalog-dashboard-grid">${cards||'<p class="management-empty">No hay productos que coincidan con esos filtros.</p>'}</div>${loose?`<section class="catalog-unassigned-section"><h4>Casos especiales · trabajos sin producto (${loose.length})</h4><div class="catalog-unassigned-grid">${loose}</div></section>`:''}`;
}

function renderAssignments(root) {
  if (!appState.jobs.length) { root.innerHTML='<p class="management-empty">Registra primero un trabajo para poder asignarlo.</p>'; return; }
  root.innerHTML=appState.jobs.map(j=>{
    const selected=j.data.productoId||'';
    return `<label class="assignment-row"><span><b>${esc(j.data.nombre)}</b><small>${esc(j.data.cliente||'Sin cliente')} · ${pieces(j)} piezas vendibles</small></span><select data-job-product="${esc(j.id)}"><option value="">Sin producto</option>${appState.products.map(p=>`<option value="${esc(p.id)}" ${selected===p.id?'selected':''}>${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}</select></label>`;
  }).join('')+'<button class="management-button" id="save-assignments">Guardar asignaciones</button>';
}
function renderClientsTable(root, query='') {
  const q=query.toLowerCase();
  const rows=appState.clients.filter(c=>[c.nombre,c.telefono,c.notas,c.tipo].join(' ').toLowerCase().includes(q));
  if(!rows.length){root.innerHTML='<p class="management-empty">No hay clientes o tiendas que coincidan.</p>';return;}
  root.innerHTML=`<table class="management-table"><thead><tr><th>Tipo</th><th>Nombre</th><th>Teléfono</th><th>Contacto</th><th>Dirección</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.tipo)}</td><td><b>${esc(c.nombre)}</b><small>${esc(c.notas)}</small></td><td>${esc(c.telefono)}</td><td>${esc(c.contacto)}</td><td>${esc(c.direccion)}</td><td><button class="management-link" data-client-history="${esc(c.id)}">Historial</button> <button class="management-link" data-client-edit="${esc(c.id)}">Editar</button> <button class="management-link danger" data-client-delete="${esc(c.id)}">Eliminar</button></td></tr>`).join('')}</tbody></table>`;
}
function renderSalesTable(root) {
  const sales=[...appState.sales].sort((a,b)=>Number(b.fecha||b.createdAt||0)-Number(a.fecha||a.createdAt||0));
  const total=sales.reduce((sum,sale)=>sum+Number(sale.monto||0),0);
  const units=sales.reduce((sum,sale)=>sum+Number(sale.cantidad||1),0);
  const average=sales.length?total/sales.length:0;
  const summary=root.parentElement.querySelector('#sales-summary');
  if(summary)summary.innerHTML=`<div><span>OPERACIONES</span><b>${sales.length}</b></div><div><span>UNIDADES VENDIDAS</span><b>${units}</b></div><div><span>INGRESOS REGISTRADOS</span><b>${money(total)}</b></div><div><span>VENTA PROMEDIO</span><b>${money(average)}</b></div>`;
  if(!sales.length){root.innerHTML='<p class="management-empty">Todavía no hay ventas registradas.</p>';return;}
  root.innerHTML=`<table class="management-table sales-detail-table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Producto</th><th>Trabajo</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th><th>Pago</th><th>Vendido por</th><th>Notas</th><th></th></tr></thead><tbody>${sales.map(s=>{
    const qty=Number(s.cantidad||1), unit=qty?Number(s.monto||0)/qty:0;
    return `<tr><td>${dateText(s.fecha)}</td><td><b>${esc(s.cliente||'Sin cliente')}</b></td><td>${esc(s.productoNombre||'Sin producto asociado')}</td><td>${esc(s.jobNombre||'Venta independiente')}</td><td><b>${qty}</b></td><td>${money(unit)}</td><td class="sales-total">${money(s.monto)}</td><td><span class="sales-payment">${esc(s.metodoPago||'No especificado')}</span></td><td>${esc(s.vendidoPor||'—')}</td><td class="sales-notes" title="${esc(s.notas||'Sin notas')}">${esc(s.notas||'—')}</td><td><button class="management-link danger" data-sale-delete="${esc(s.id)}">Eliminar</button></td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderConsignments(root) {
  if(!appState.consignments.length){root.innerHTML='<p class="management-empty">Todavía no hay entregas registradas.</p>';return;}
  root.innerHTML=`<table class="management-table"><thead><tr><th>Fecha</th><th>Tienda</th><th>Producto</th><th>Entregado</th><th>Devuelto</th><th>A cobrar</th><th>Pagado</th><th></th></tr></thead><tbody>${[...appState.consignments].sort((a,b)=>b.fecha-a.fecha).map(c=>{
    const balance=consignmentBalance(c);
    return `<tr><td>${dateText(c.fecha)}</td><td><b>${esc(c.tienda)}</b></td><td>${esc(c.productoNombre)}</td><td>${c.cantidad}</td><td>${c.cantidadDevuelta||0}</td><td>${money(balance.due)}</td><td>${money(balance.paid)}${balance.credit>0?`<small>Saldo a favor: ${money(balance.credit)}</small>`:''}</td><td><button class="management-link" data-cons-pay="${esc(c.id)}">Pago</button> <button class="management-link" data-cons-return="${esc(c.id)}">Devolución</button> <button class="management-link danger" data-cons-delete="${esc(c.id)}">Eliminar</button></td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderConsignmentSummary(root) {
  const map=new Map();
  appState.consignments.forEach(c=>{const n=Math.max(0,c.cantidad-(c.cantidadDevuelta||0));const balance=consignmentBalance(c);const row=map.get(c.tienda)||{pieces:0,pending:0,credit:0};row.pieces+=n;row.pending+=balance.pending;row.credit+=balance.credit;map.set(c.tienda,row);});
  root.innerHTML=map.size?[...map].map(([name,r])=>`<div class="summary-row"><b>${esc(name)}</b><span>${r.pieces} piezas · pendiente ${money(r.pending)}${r.credit>0?' · saldo a favor '+money(r.credit):''}</span></div>`).join(''):'<p class="management-empty">Sin entregas aún.</p>';
}

function attachBackup(root) {
  root.querySelector('#backup-export').addEventListener('click',exportBackup);
  root.querySelector('#backup-import').addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    if(!confirm('La importación reemplazará todos los datos actuales de Agencia de Modelos 3D en Firebase. ¿Continuar?')){e.target.value='';return;}
    try{await importBackup(file);notify('Respaldo importado correctamente.');renderManagementView(root,active);}catch(error){alert(error.message);}
  });
}

function openProductDialog(root, product=null) {
  const editing=Boolean(product);
  const dialog=document.createElement('dialog');
  dialog.className='management-form-dialog product-edit-dialog';
  const typeOptions=PRODUCT_TYPES.map(([value,label])=>`<option value="${value}" ${(product?.tipo||'ACC')===value?'selected':''}>${label}</option>`).join('');
  const initialType=product?.tipo||'ACC';
  const initialCode=product?.codigo||nextProductCode(initialType);
  dialog.innerHTML=`<form method="dialog" class="management-dialog-form" id="product-dialog-form">
    <div class="management-dialog-heading"><div><p class="eyebrow">CATÁLOGO DE PRODUCTOS</p><h3>${editing?'Editar producto':'Crear producto'}</h3><p>${editing?'Actualiza los datos del producto. Los trabajos y ventas vinculados se conservarán.':'El código se genera automáticamente según el tipo y puedes modificarlo antes de guardar.'}</p></div><button type="button" class="management-dialog-close" aria-label="Cerrar" data-dialog-close>×</button></div>
    <label class="management-field">Tipo de producto<select name="tipo" required>${typeOptions}</select></label>
    <label class="management-field">Nombre del producto<input name="nombre" required maxlength="120" value="${esc(product?.nombre||'')}" placeholder="Ej. Soporte para celular"></label>
    <label class="management-field">Código del producto<div class="management-code-field"><input name="codigo" required maxlength="60" value="${esc(initialCode)}"><button type="button" class="management-button secondary" data-regenerate-code>Generar</button></div><small>Debe ser único en todo el catálogo, incluidas las variantes.</small></label>
    <div class="product-image-editor"><label class="management-field">Imagen del producto<input name="imagen" type="file" accept="image/*"><small>Pega con Ctrl+V o sube una imagen. Arrástrala dentro del recuadro para elegir el encuadre; no se deforma.</small></label><div class="product-image-crop-area"><div class="product-image-preview" data-product-image-preview aria-label="Arrastra la imagen para ajustar el recorte">${product?.imageUrl?`<img src="${esc(product.imageUrl)}" alt="Vista previa actual">`:'<span>Sin imagen seleccionada</span>'}</div><small class="product-image-crop-hint">Vista cuadrada · arrastra para mover</small></div></div>
    <label class="management-field">Descripción para el catálogo público<textarea name="descripcionCatalogo" rows="3" maxlength="1200" placeholder="Describe el producto para tus clientes…">${esc(product?.descripcionCatalogo||'')}</textarea><small>Esta descripción será visible en la página pública; las notas internas no se publican.</small></label>
    <label class="management-field">Precio de venta para el catálogo (Bs)<input name="precioVenta" type="number" min="0" step="0.01" value="${esc(product?.precioVenta??'')}" placeholder="Ej. 85.00"><small>Precio independiente de las cotizaciones de trabajos.</small></label>
    <label class="management-field"><span><input name="publicadoCatalogo" type="checkbox" ${product?.publicadoCatalogo===true?'checked':''}> Publicar este producto en el catálogo público</span><small>Al activarlo, el producto y su precio serán visibles para cualquier visitante.</small></label>
    <label class="management-field">Notas internas<textarea name="notas" rows="3">${esc(product?.notas||'')}</textarea></label>
    <p class="management-dialog-error" role="alert" hidden></p>
    <div class="management-dialog-actions"><button type="button" class="management-button secondary" data-dialog-close>Cancelar</button><button type="submit" class="management-button">${editing?'Guardar cambios':'Crear producto'}</button></div>
  </form>`;
  const form=dialog.querySelector('form');
  const error=dialog.querySelector('.management-dialog-error');
  const imageInput=form.elements.imagen,imagePreview=dialog.querySelector('[data-product-image-preview]');
  let previewObjectUrl=null,cropX=50,cropY=50,dragPoint=null;
  const paintImagePreview=source=>{imagePreview.innerHTML=source?'<img src="'+source+'" alt="Vista previa del recorte" draggable="false">':'<span>Sin imagen seleccionada</span>';const image=imagePreview.querySelector('img');if(image){image.style.objectPosition=cropX+'% '+cropY+'%';image.addEventListener('load',()=>{image.style.objectPosition=cropX+'% '+cropY+'%';},{once:true});}};
  paintImagePreview(product?.imageUrl||null);
  imageInput.addEventListener('change',()=>{const file=imageInput.files?.[0];if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);previewObjectUrl=null;cropX=50;cropY=50;if(!file){paintImagePreview(product?.imageUrl||null);return;}if(!file.type.startsWith('image/')){imageInput.value='';paintImagePreview(product?.imageUrl||null);return;}previewObjectUrl=URL.createObjectURL(file);paintImagePreview(previewObjectUrl);});
  imagePreview.addEventListener('pointerdown',event=>{const image=imagePreview.querySelector('img');if(!image)return;event.preventDefault();imagePreview.setPointerCapture(event.pointerId);dragPoint={x:event.clientX,y:event.clientY,pointerId:event.pointerId};imagePreview.classList.add('is-dragging');});
  imagePreview.addEventListener('pointermove',event=>{if(!dragPoint||dragPoint.pointerId!==event.pointerId)return;const image=imagePreview.querySelector('img');if(!image)return;const frameW=imagePreview.clientWidth,frameH=imagePreview.clientHeight,ratio=(image.naturalWidth||1)/(image.naturalHeight||1),renderW=Math.max(frameW,frameH*ratio),renderH=Math.max(frameH,frameW/ratio),overflowX=renderW-frameW,overflowY=renderH-frameH,dx=event.clientX-dragPoint.x,dy=event.clientY-dragPoint.y;if(overflowX>0)cropX=Math.max(0,Math.min(100,cropX-dx/overflowX*100));if(overflowY>0)cropY=Math.max(0,Math.min(100,cropY-dy/overflowY*100));dragPoint={...dragPoint,x:event.clientX,y:event.clientY};image.style.objectPosition=cropX+'% '+cropY+'%';});
  const stopImageDrag=event=>{if(dragPoint&&(!event||event.pointerId===dragPoint.pointerId)){dragPoint=null;imagePreview.classList.remove('is-dragging');}};
  imagePreview.addEventListener('pointerup',stopImageDrag);imagePreview.addEventListener('pointercancel',stopImageDrag);
  dialog.addEventListener('paste',event=>{
    const items=Array.from(event.clipboardData?.items||[]);
    const imageItem=items.find(item=>item.kind==='file'&&item.type.startsWith('image/'));
    const pasted=imageItem?.getAsFile();
    if(!pasted)return;
    event.preventDefault();
    const extension=pasted.type==='image/jpeg'?'jpg':pasted.type==='image/webp'?'webp':pasted.type==='image/gif'?'gif':'png';
    const file=new File([pasted],`imagen-producto-${Date.now()}.${extension}`,{type:pasted.type});
    const transfer=new DataTransfer();
    transfer.items.add(file);
    imageInput.files=transfer.files;
    imageInput.dispatchEvent(new Event('change',{bubbles:true}));
    notify('Imagen pegada. Se guardará al actualizar el producto.');
  });
  dialog.addEventListener('close',()=>{if(previewObjectUrl)URL.revokeObjectURL(previewObjectUrl);dialog.remove();});
  const codeInput=form.elements.codigo;
  const regenerate=()=>{codeInput.value=nextProductCode(form.elements.tipo.value);};
  form.elements.tipo.addEventListener('change',()=>{if(!editing||codeInput.dataset.manual!=='true')regenerate();});
  codeInput.addEventListener('input',()=>{codeInput.dataset.manual='true';});
  dialog.querySelector('[data-regenerate-code]').addEventListener('click',()=>{codeInput.dataset.manual='false';regenerate();});
  dialog.querySelectorAll('[data-dialog-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const data=Object.fromEntries(new FormData(form));
    const name=String(data.nombre||'').trim(), code=String(data.codigo||'').trim(), type=String(data.tipo||'').trim().toUpperCase();
    error.hidden=true;
    if(!name||!code||!PRODUCT_TYPES.some(([value])=>value===type)){error.textContent='Completa el nombre, tipo y código del producto.';error.hidden=false;return;}
    if(!isProductCodeAvailable(code,appState.products,{productId:product?.id||null,kind:'product'})){error.textContent='Ese código ya está utilizado por otro producto o variante.';error.hidden=false;return;}
    const previous=product?{...product}:null;
    const catalogPriceText=String(data.precioVenta??'').trim();
    const catalogPrice=catalogPriceText===''?0:Number(catalogPriceText);
    const publishToCatalog=form.elements.publicadoCatalogo.checked;
    if(publishToCatalog&&(!Number.isFinite(catalogPrice)||catalogPrice<=0)){error.textContent='Para publicar el producto, define primero un precio de venta mayor que cero.';error.hidden=false;return;}
    if(publishToCatalog&&!imageInput.files?.[0]&&!/^https:\/\//i.test(String(product?.imageUrl||''))){error.textContent='Para publicar el producto, primero añade su fotografía. Se guardará en Cloudinary y aparecerá en el catálogo público.';error.hidden=false;return;}
    if(catalogPriceText!==''&&(!Number.isFinite(catalogPrice)||catalogPrice<0)){error.textContent='El precio de venta debe ser un número igual o mayor que cero.';error.hidden=false;return;}
    const record=product||{id:makeId('prod'),createdAt:Date.now()};
    Object.assign(record,{codigo:code,tipo:type,nombre:name,notas:String(data.notas||'').trim(),descripcionCatalogo:String(data.descripcionCatalogo||'').trim(),precioVenta:catalogPrice,publicadoCatalogo:publishToCatalog});
    const selectedImage=imageInput.files?.[0]||null;
    if(!product)appState.products.push(record);
    const submit=form.querySelector('[type="submit"]');submit.disabled=true;submit.textContent='Guardando…';
    try{
      if(selectedImage)record.imageUrl=await uploadProductImage(selectedImage,record.id,{x:cropX,y:cropY});
      const persisted=await saveAppState();
      if(!persisted)throw new Error('Firestore no confirmó el guardado.');
      dialog.close();renderManagementView(root,'products');notify(editing?'Producto actualizado.':'Producto creado con el código '+code+'.');
    }catch(err){
      if(product)Object.assign(product,previous);else appState.products=appState.products.filter(item=>item.id!==record.id);
      error.textContent='No se pudo guardar: '+err.message;error.hidden=false;submit.disabled=false;submit.textContent=editing?'Guardar cambios':'Crear producto';
    }
  });
  document.body.append(dialog);dialog.showModal();
}



function openProductCatalogDialog(root,product) {
  const linkedJobs=appState.jobs.filter(job=>job&&job.data&&String(job.data.catalogoProductoId||job.data.productoId||job.data.productId||job.data.producto?.id||'')===String(product.id));
  if(!linkedJobs.length){
    alert('Este producto todavía no tiene trabajos asociados. Asigna primero los trabajos al producto desde la tabla de Productos.');
    return;
  }
  if(!/^https:\/\//i.test(String(product.imageUrl||''))){
    alert('Este producto no tiene una fotografía guardada. Añade primero su imagen en Editar producto; todas sus publicaciones utilizarán esa fotografía.');
    return;
  }
  const productColors=getProductVariants(product).filter(variant=>variant&&variant.activo!==false).map(variant=>String(variant.nombre||'').trim()).filter(Boolean);
  const dialog=document.createElement('dialog');
  dialog.className='management-form-dialog product-catalog-publish-dialog';
  const rows=linkedJobs.map(job=>{
    const data=job.data||{};
    const colors=Array.isArray(data.catalogoColores)?data.catalogoColores:productColors;
    const checked=data.catalogoPublicado===true;
    const quoteAmount=Number(job.calc?.precioVenta||0);
    return '<article class="catalog-publish-job" data-catalog-job-row="'+esc(job.id)+'">'+
      '<label class="catalog-publish-job-select"><input type="checkbox" data-catalog-job="'+esc(job.id)+'" '+(checked?'checked':'')+'><span><b>'+esc(data.nombre||product.nombre)+'</b><small>'+esc(data.codigoCatalogo||'Código TR pendiente')+' · '+esc(data.cliente||'Sin cliente')+'</small></span>'+(checked?'<strong class="catalog-publish-status">YA PUBLICADO</strong>':'')+'</label>'+
      '<p class="catalog-publish-quote-reference"><span>Monto de cotización registrado</span><strong>'+money(quoteAmount)+'</strong><small>Referencia interna; no se mostrará en el catálogo público.</small></p>'+
      '<div class="catalog-publish-job-fields">'+
        '<label class="management-field">Precio de publicación (Bs)<input type="number" min="0.01" step="0.01" data-catalog-price="'+esc(job.id)+'" value="'+esc(data.catalogoPrecioVenta??'')+'" placeholder="Ej. 85.00"></label>'+
        '<label class="management-field">Colores para esta publicación<input type="text" data-catalog-colors="'+esc(job.id)+'" value="'+esc(colors.join(', '))+'" placeholder="Rojo, azul, negro"><small>Se cargan desde las variantes del producto. Puedes editar la lista separando los colores por comas.</small></label>'+
        '<label class="catalog-publish-other-colors"><input type="checkbox" data-catalog-others="'+esc(job.id)+'" '+(data.catalogoOtrosColores!==false?'checked':'')+'> Mostrar «Otros colores disponibles a pedido»</label>'+
      '</div></article>';
  }).join('');
  dialog.innerHTML='<form method="dialog" class="management-dialog-form">'+
    '<div class="management-dialog-heading"><div><p class="eyebrow">CATÁLOGO PÚBLICO</p><h3>Publicar trabajos</h3><p>'+esc(product.nombre)+' · La fotografía se tomará del registro del producto.</p></div><button type="button" class="management-dialog-close" data-catalog-close>×</button></div>'+
    '<div class="catalog-publish-product-preview"><img src="'+esc(product.imageUrl)+'" alt="'+esc(product.nombre)+'"><div><b>'+esc(product.nombre)+'</b><small>'+esc(product.codigo)+' · '+(productColors.length?productColors.length+' colores/variantes registrados':'Sin colores registrados en variantes')+'</small><small>El costo interno del producto no se publica.</small></div></div>'+
    '<p class="management-help">Selecciona los trabajos que quieres mostrar. Cada trabajo tendrá su propio precio y colores; los cambios aquí no modificarán el producto ni sus variantes originales.</p>'+
    '<div class="catalog-publish-job-list">'+rows+'</div>'+
    '<p class="management-dialog-error" role="alert" hidden></p>'+
    '<div class="management-dialog-actions"><button type="button" class="management-button secondary" data-catalog-close>Cancelar</button><button type="submit" class="management-button">Guardar publicaciones</button></div>'+
  '</form>';
  const form=dialog.querySelector('form');
  const error=dialog.querySelector('.management-dialog-error');
  dialog.querySelectorAll('[data-catalog-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    error.hidden=true;
    const updates=[];
    for(const job of linkedJobs){
      const id=String(job.id);
      const selected=form.querySelector('[data-catalog-job="'+CSS.escape(id)+'"]')?.checked===true;
      const priceText=String(form.querySelector('[data-catalog-price="'+CSS.escape(id)+'"]')?.value||'').trim();
      const price=Number(priceText);
      if(selected&&(!Number.isFinite(price)||price<=0)){
        error.textContent='Define un precio mayor que cero para cada trabajo seleccionado.';
        error.hidden=false;
        return;
      }
      const colorsText=String(form.querySelector('[data-catalog-colors="'+CSS.escape(id)+'"]')?.value||'');
      const colors=[...new Set(colorsText.split(',').map(value=>value.trim()).filter(Boolean))].slice(0,30);
      updates.push({job,selected,price,colors,others:form.querySelector('[data-catalog-others="'+CSS.escape(id)+'"]')?.checked!==false});
    }
    const previous=updates.map(item=>({job:item.job,data:JSON.parse(JSON.stringify(item.job.data||{}))}));
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;
    submit.textContent='Guardando…';
    try{
      for(const item of updates){
        const data=item.job.data||(item.job.data={});
        data.catalogoPublicado=item.selected;
        data.catalogoProductoId=product.id;
        data.catalogoColores=item.colors;
        data.catalogoOtrosColores=item.others;
        if(item.selected){
          data.catalogoPrecioVenta=item.price;
          data.catalogoDescripcion=String(data.descripcion||product.descripcionCatalogo||'').trim();
          if(!data.codigoCatalogo){
            const suffix=String(item.job.id||'').replace(/[^a-z0-9]/gi,'').slice(-8).toUpperCase();
            data.codigoCatalogo='TR-'+(suffix||'TRABAJO');
          }
        }
        item.job.updatedAt=Date.now();
      }
      const persisted=await saveAppState();
      if(!persisted)throw new Error('Firestore no confirmó el guardado.');
      dialog.close();
      renderManagementView(root,'products');
      notify('Publicaciones de trabajos guardadas. La sincronización del catálogo se realiza en segundo plano.');
    }catch(err){
      for(const item of previous){item.job.data=item.data;}
      alert('No se pudieron guardar las publicaciones: '+err.message);
      submit.disabled=false;
      submit.textContent='Guardar publicaciones';
    }
  });
  document.body.append(dialog);
  dialog.showModal();
}

function openVariantDialog(root,product) {
  const dialog=document.createElement('dialog');dialog.className='management-form-dialog product-edit-dialog';
  dialog.innerHTML=`<form method="dialog" class="management-dialog-form"><div class="management-dialog-heading"><div><p class="eyebrow">VARIANTES</p><h3>Nueva variante</h3><p>${esc(product.nombre)} · Código base ${esc(product.codigo)}</p></div><button type="button" class="management-dialog-close" data-dialog-close>×</button></div><label class="management-field">Nombre de la variante<input name="nombre" required placeholder="Ej. Negro"></label><label class="management-field">Código / SKU<div class="management-code-field"><input name="codigo" required><button type="button" class="management-button secondary" data-regenerate-variant>Generar</button></div></label><p class="management-dialog-error" role="alert" hidden></p><div class="management-dialog-actions"><button type="button" class="management-button secondary" data-dialog-close>Cancelar</button><button type="submit" class="management-button">Guardar variante</button></div></form>`;
  const form=dialog.querySelector('form'),code=form.elements.codigo,error=dialog.querySelector('.management-dialog-error');
  const generate=()=>{code.value=nextVariantCode(product,form.elements.nombre.value);};
  form.elements.nombre.addEventListener('input',generate);dialog.querySelector('[data-regenerate-variant]').addEventListener('click',generate);
  dialog.querySelectorAll('[data-dialog-close]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  form.addEventListener('submit',async e=>{e.preventDefault();try{const values=validateVariantInput({code:code.value,name:form.elements.nombre.value},appState.products);const variant={id:makeId('var'),...values,activo:true,createdAt:Date.now()};if(!Array.isArray(product.variantes))product.variantes=[];product.variantes.push(variant);const ok=await saveAppState();if(!ok)throw new Error('Firestore no confirmó el guardado.');dialog.close();renderManagementView(root,'products');notify('Variante guardada.');}catch(err){error.textContent=err.message;error.hidden=false;}});
  document.body.append(dialog);dialog.showModal();
}

function attachProducts(root) {
  root.querySelector('#catalog-add-product').addEventListener('click',()=>openProductDialog(root));
  const getFilters=()=>({search:root.querySelector('#product-search').value,from:root.querySelector('#catalog-date-from').value,to:root.querySelector('#catalog-date-to').value,type:root.querySelector('#catalog-type-filter').value,status:root.querySelector('#catalog-status-filter').value,client:root.querySelector('#catalog-client-filter').value});
  const refresh=()=>renderProductsTable(root.querySelector('#products-table'),getFilters());
  ['#product-search','#catalog-client-filter'].forEach(selector=>root.querySelector(selector).addEventListener('input',refresh));
  ['#catalog-date-from','#catalog-date-to','#catalog-type-filter','#catalog-status-filter'].forEach(selector=>root.querySelector(selector).addEventListener('change',refresh));
  root.querySelector('#catalog-clear-filters').addEventListener('click',()=>{['#product-search','#catalog-date-from','#catalog-date-to','#catalog-type-filter','#catalog-status-filter','#catalog-client-filter'].forEach(selector=>root.querySelector(selector).value='');refresh();});
  root.querySelector('#products-table').addEventListener('click',async e=>{
    const catalogToggle=e.target.closest('[data-product-toggle-catalog]');
    if(catalogToggle){
      const product=getProduct(catalogToggle.dataset.productToggleCatalog);
      if(product)openProductCatalogDialog(root,product);
      return;
    }
    const edit=e.target.closest('[data-product-edit]'),del=e.target.closest('[data-product-delete]'),barcode=e.target.closest('[data-product-barcode]');
    const addVariant=e.target.closest('[data-variant-add]'),variantBarcode=e.target.closest('[data-variant-barcode]'),downloadBarcode=e.target.closest('[data-download-barcode]');
    if(downloadBarcode){downloadBarcodeSvg(downloadBarcode.dataset.downloadBarcode);return;}
    if(barcode){const product=getProduct(barcode.dataset.productBarcode);if(product)printProductBarcode(product);}
    if(variantBarcode){const product=getProduct(variantBarcode.dataset.variantBarcode);const variant=getProductVariants(product).find(item=>item.id===variantBarcode.dataset.variantId);if(product&&variant)printProductBarcode(product,variant);}
    if(addVariant){
      const product=getProduct(addVariant.dataset.variantAdd);if(!product)return;
      openVariantDialog(root,product);
      return;
    }
    if(edit){const p=getProduct(edit.dataset.productEdit);if(p)openProductDialog(root,p);}
    if(del){const id=del.dataset.productDelete;
      const hasSales=appState.sales.some(s=>s.productoId===id);
      const hasConsignments=appState.consignments.some(c=>c.productoId===id);
      const hasJobs=appState.jobs.some(j=>j.data?.productoId===id);
      if(hasSales||hasConsignments||hasJobs){alert('No se puede eliminar este producto porque tiene historial comercial o trabajos vinculados. Para conservar la trazabilidad, mantenlo en el catálogo; más adelante se podrá marcar como inactivo.');return;}
      if(!confirm('¿Eliminar este producto sin movimientos ni trabajos asociados?'))return;
      appState.products=appState.products.filter(p=>p.id!==id);saveAppState();renderManagementView(root,'products');notify('Producto eliminado.');}
  });
  root.querySelector('#products-table').addEventListener('change',e=>{
    const productSelect=e.target.closest('[data-existing-product]');
    if(productSelect){const jobId=productSelect.dataset.existingProduct;const product=getProduct(productSelect.value);const variantSelect=root.querySelector('[data-existing-variant="'+jobId+'"]');if(variantSelect){variantSelect.innerHTML='<option value="">Sin variante</option>'+getProductVariants(product).map(v=>'<option value="'+esc(v.id)+'">'+esc(v.nombre)+' · '+esc(v.codigo)+'</option>').join('');}return;}
    const type=e.target.closest('[data-new-type]');
    if(type){
      const codeField=root.querySelector('[data-new-code="'+type.dataset.newType+'"]');
      if(codeField)codeField.value=nextProductCode(type.value);
    }
  });
  root.querySelector('#products-table').addEventListener('click',async e=>{
    const reverseButton=e.target.closest('[data-reverse-production-batch]');
    if(reverseButton){
      const job=getJob(reverseButton.dataset.reverseProductionBatch);
      const batch=job?.data?.productionBatches?.find(item=>item.id===reverseButton.dataset.batchId);
      if(!job||!batch){alert('No se encontró el trabajo o lote.');return;}
      if(batch.status==='reversed'){alert('Este lote ya está revertido.');return;}
      let quantity;
      try{
        ({quantity}=assertProductionBatchCanReverse(job,batch,appState.jobs,appState.sales,appState.consignments));
      }catch(error){alert('No se puede revertir: '+error.message);return;}
      const reason=prompt('Motivo de la reversión del lote:');
      if(reason===null)return;
      const reversalId=makeId('reversion-lote');
      const previousJobData=JSON.parse(JSON.stringify(job.data));
      const previousProducts=JSON.parse(JSON.stringify(appState.products));
      const previousMaterials=JSON.parse(JSON.stringify(inventoryState.materials));
      const previousMovements=JSON.parse(JSON.stringify(inventoryState.jobMovements));
      reverseButton.disabled=true;
      try{
        const event=reverseProductionBatch(batch,reason,reversalId);
        reverseProductionBatchMaterials(batch,reversalId);
        if(!Array.isArray(job.data.productionBatchReversals))job.data.productionBatchReversals=[];
        job.data.productionBatchReversals.push(event);
        batch.status='reversed';
        batch.reversedAt=event.date;
        batch.reversalId=reversalId;
        job.updatedAt=Date.now();
        const persisted=await saveAppState();
        if(!persisted) throw new Error('Firestore no confirmó el guardado. Se restauraron los datos de esta operación en pantalla.');
        renderManagementView(root,'products');
        notify('Lote revertido y guardado en Firestore.');
      }catch(error){
        job.data=previousJobData;
        appState.products.splice(0,appState.products.length,...previousProducts);
        inventoryState.materials.splice(0,inventoryState.materials.length,...previousMaterials);
        inventoryState.jobMovements.splice(0,inventoryState.jobMovements.length,...previousMovements);
        alert('No se pudo completar la reversión: '+error.message);
        renderManagementView(root,'products');
      }
      return;
    }
    const batchButton=e.target.closest('[data-production-batch]');
    if(batchButton){
      const job=getJob(batchButton.dataset.productionBatch);
      if(!job?.data){alert('No se encontró el trabajo.');return;}
      let produced=1, failed=0, consumptions, batchOptions;
      try {
        consumptions=getProductionBatchMaterialConsumptions(job,inventoryState.jobMovements,produced);
        if(!consumptions.length) throw new Error('No se encontró una receta de materiales para este trabajo. No se puede registrar la reimpresión sin un consumo verificable.');
        const missing=consumptions.filter(row=>!inventoryState.materials.some(material=>material.id===row.materialId));
        if(missing.length) throw new Error('El trabajo original contiene un material que ya no está en el inventario. Revisa el registro antes de reimprimir.');

        batchOptions=await requestProductionBatchOptions(job,consumptions);
        if(!batchOptions)return;
        produced=batchOptions.produced;
        failed=batchOptions.failed;
        consumptions=batchOptions.consumptions.map(row=>({...row,grams:Number((row.grams*produced).toFixed(3))}));
        const combined=new Map();
        for(const row of consumptions) combined.set(row.materialId,(combined.get(row.materialId)||0)+row.grams);
        const insufficient=[...combined].map(([id,grams])=>({grams,material:inventoryState.materials.find(item=>item.id===id)}))
          .filter(({grams,material})=>!material||Number(material.stock||0)+1e-9<grams);
        if(insufficient.length) throw new Error('Stock insuficiente para la reimpresión: '+insufficient.map(({grams,material})=>(material?.nombre||'Material')+' requiere '+grams.toFixed(1)+' g y tiene '+Number(material?.stock||0).toFixed(1)+' g').join('; '));
        consumptions=[...combined].map(([materialId,grams])=>({materialId,grams}));
      } catch(error) { alert(error.message); return; }
      const previousJobData=JSON.parse(JSON.stringify(job.data));
      const previousProducts=JSON.parse(JSON.stringify(appState.products));
      const previousMaterials=JSON.parse(JSON.stringify(inventoryState.materials));
      const previousMovements=JSON.parse(JSON.stringify(inventoryState.jobMovements));
      batchButton.disabled=true;
      try{
        if(!Array.isArray(job.data.productionBatches))job.data.productionBatches=[];
        const changedMaterials=consumptions.some((row,index)=>row.materialId!==getProductionBatchMaterialConsumptions(job,inventoryState.jobMovements,produced)[index]?.materialId);
        const product=getProduct(job.data.productoId);
        const variant=changedMaterials&&product?createVariantForBatch(product,consumptions.map(row=>row.materialId)):null;
        const batch=createProductionBatch(job,{id:makeId('lote'),date:Date.now(),producedQuantity:produced,failedQuantity:failed,materialConsumptions:consumptions,variantId:variant?.id||job.data.variantId||null,variantName:variant?.nombre||null},job.data.productionBatches);
        applyProductionBatchMaterials(job,batch);
        job.data.productionBatches.push(batch);
        job.updatedAt=Date.now();
        const persisted=await saveAppState();
        if(!persisted) throw new Error('Firestore no confirmó el guardado. Se restauraron los datos de esta operación en pantalla.');
        renderManagementView(root,'products');
        notify('Reimpresión registrada y guardada: '+batch.sellableQuantity+' piezas vendibles.');
      }catch(error){
        job.data=previousJobData;
        appState.products.splice(0,appState.products.length,...previousProducts);
        inventoryState.materials.splice(0,inventoryState.materials.length,...previousMaterials);
        inventoryState.jobMovements.splice(0,inventoryState.jobMovements.length,...previousMovements);
        alert('No se pudo registrar la reimpresión: '+error.message);
        renderManagementView(root,'products');
      }
      return;
    }
    const sellJob=e.target.closest('[data-sell-job]');
    const assign=e.target.closest('[data-assign-existing]');
    const create=e.target.closest('[data-create-assign]');
    if(create){
      const job=getJob(create.dataset.createAssign);
      const nameField=root.querySelector('[data-new-name="'+create.dataset.createAssign+'"]');
      const typeField=root.querySelector('[data-new-type="'+create.dataset.createAssign+'"]');
      const codeField=root.querySelector('[data-new-code="'+create.dataset.createAssign+'"]');
      const name=String(nameField?.value||'').trim();
      const type=String(typeField?.value||'').trim().toUpperCase();
      const code=String(codeField?.value||'').trim();
      if(!job?.data){alert('No se encontró el trabajo que deseas asignar.');return;}
      if(!name||!code||!PRODUCT_TYPES.some(([value])=>value===type)){alert('Completa un nombre, tipo y código válido.');return;}
      if(!isProductCodeAvailable(code,appState.products,{kind:'product'})){alert('El código '+code+' ya está utilizado.');return;}
      const previousProductId=job.data.productoId??null;
      const previousVariantId=job.data.variantId??null;
      const product={id:makeId('prod'),codigo:code,tipo:type,nombre:name,notas:'',createdAt:Date.now()};
      create.disabled=true;
      appState.products.push(product);
      job.data.productoId=product.id;
      job.data.variantId=null;
      job.updatedAt=Date.now();
      try{
        const persisted=await saveAppState();
        if(!persisted)throw new Error('Firestore no confirmó el guardado.');
        renderManagementView(root,'products');
        notify('Producto creado y trabajo asignado con el código '+code+'.');
      }catch(error){
        appState.products=appState.products.filter(item=>item.id!==product.id);
        job.data.productoId=previousProductId;
        job.data.variantId=previousVariantId;
        alert('No se pudo crear y asignar el producto: '+error.message);
        renderProductsTable(root.querySelector('#products-table'),root.querySelector('#product-search')?.value||'');
      }
      return;
    }
    if(sellJob){
      const job=getJob(sellJob.dataset.sellJob),product=getProduct(job?.data?.productoId);
      if(!job||!product){alert('Primero asigna este trabajo a un producto del catálogo.');return;}
      const variants=getProductVariants(product),variant=variants.find(v=>v.id===job.data?.variantId);
      if(variants.length&&!variant){alert('Selecciona y guarda la variante/código antes de vender.');return;}
      const qtyText=prompt('Cantidad a vender. Disponibles: '+Math.max(0,pieces(job)-appState.sales.filter(x=>x.jobId===job.id).reduce((n,x)=>n+Number(x.cantidad||1),0)),'1');
      if(qtyText===null)return;const qty=Number(qtyText);
      if(!Number.isSafeInteger(qty)||qty<1){alert('Ingresa una cantidad entera válida.');return;}
      const unit=Number(job.calc?.precioUnitario||job.calc?.precioVenta||0);
      const amountText=prompt('Monto total de la venta (Bs):',String((unit*qty).toFixed(2)));
      if(amountText===null)return;const amount=Number(amountText);
      if(!Number.isFinite(amount)||amount<=0){alert('Ingresa un monto válido.');return;}
      const client=prompt('Cliente (opcional):','')??'';
      try{assertJobCanSell(job,qty,appState.sales);if(variant)assertJobVariantCanSell(job,variant.id,qty,appState.sales);else assertProductCanMove(product.id,qty,appState.jobs,appState.sales,appState.consignments);}catch(error){alert(error.message);return;}
      const sale={id:makeId('venta'),clientId:findClientByName(client)?.id||null,jobId:job.id,jobNombre:job.data.nombre||'',productoId:product.id,variantId:variant?.id||null,productoNombre:product.nombre,cliente:client.trim(),cantidad:qty,monto:amount,fecha:Date.now(),metodoPago:'No especificado',vendidoPor:'',notas:'',createdAt:Date.now()};
      appState.sales.push(sale);sellJob.disabled=true;
      try{const persisted=await saveAppState();if(!persisted)throw new Error('Firestore no confirmó el registro.');renderProductsTable(root.querySelector('#products-table'),root.querySelector('#product-search').value);notify('Venta registrada en el catálogo.');}
      catch(error){appState.sales=appState.sales.filter(item=>item.id!==sale.id);alert('No se pudo guardar la venta: '+error.message);renderProductsTable(root.querySelector('#products-table'),root.querySelector('#product-search').value);}
      return;
    }
    if(assign){
      const job=getJob(assign.dataset.assignExisting);
      const select=root.querySelector('[data-existing-product="'+assign.dataset.assignExisting+'"]');
      const productId=String(select?select.value:(job?.data?.productoId||''));
      const product=appState.products.find(item=>item.id===productId);
      if(!job||!job.data||!productId||!product){alert('Selecciona un producto existente válido.');return;}
      const variantSelect=root.querySelector('[data-existing-variant="'+assign.dataset.assignExisting+'"]');
      const variantId=String(variantSelect?.value||'');
      if(variantId&&!getProductVariants(product).some(v=>v.id===variantId)){alert('La variante no pertenece al producto seleccionado.');return;}
      const previousProductId=job.data.productoId??null;
      const previousVariantId=job.data.variantId??null;
      assign.disabled=true;
      try{
        job.data.productoId=product.id;
        job.data.variantId=variantId||null;
        job.updatedAt=Date.now();
        const persisted=await saveAppState();
        if(!persisted)throw new Error('Firestore no confirmó el guardado.');
        renderProductsTable(root.querySelector('#products-table'));
        
        notify('Trabajo asignado y guardado en Firebase.');
      }catch(error){
        job.data.productoId=previousProductId;
        job.data.variantId=previousVariantId;
        alert('No se pudo guardar la asignación: '+error.message);
        renderProductsTable(root.querySelector('#products-table'));
      }
    }

  });
}
function attachClients(root) {
  const form=root.querySelector('#client-form');
  form.addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const name=d.nombre.trim();
    if(appState.clients.some(c=>c.nombre.toLowerCase()===name.toLowerCase()&&c.id!==d.id)){if(!confirm('Ya existe un registro con ese nombre. ¿Guardar igualmente?'))return;}
    const data={tipo:d.tipo,nombre:name,telefono:d.telefono.trim(),contacto:d.contacto.trim(),direccion:d.direccion.trim(),notas:d.notas.trim()};
    if(d.id)Object.assign(appState.clients.find(c=>c.id===d.id),data);else appState.clients.push({id:makeId('cli'),...data,createdAt:Date.now()});
    saveAppState();renderManagementView(root,'clients');notify('Registro guardado.');
  });
  root.querySelector('#client-search').addEventListener('input',e=>renderClientsTable(root.querySelector('#clients-table'),e.target.value));
  root.querySelector('#clients-table').addEventListener('click',e=>{
    const history=e.target.closest('[data-client-history]'),edit=e.target.closest('[data-client-edit]'),del=e.target.closest('[data-client-delete]');
    if(history){const client=appState.clients.find(x=>x.id===history.dataset.clientHistory);if(!client)return;const jobs=appState.jobs.filter(x=>x.data?.clientId===client.id);const sales=appState.sales.filter(x=>x.clientId===client.id);const consignments=appState.consignments.filter(x=>x.clientId===client.id);const total=sales.reduce((n,x)=>n+Number(x.monto||0),0);const panel=root.querySelector('#client-history');panel.hidden=false;panel.innerHTML=`<h3>Historial de ${esc(client.nombre)}</h3><div class="client-history-stats"><span>${jobs.length} trabajos</span><span>${sales.length} ventas · ${money(total)}</span><span>${consignments.length} consignaciones</span></div><ul>${jobs.map(x=>`<li>Trabajo: ${esc(x.data.nombre)} · ${dateText(x.data.fecha)}</li>`).concat(sales.map(x=>`<li>Venta: ${esc(x.productoNombre||x.jobNombre||'Venta')} · ${money(x.monto)} · ${dateText(x.fecha)}</li>`),consignments.map(x=>`<li>Consignación: ${esc(x.productoNombre)} · ${x.cantidad} unidades · ${dateText(x.fecha)}</li>`)).join('')||'<li>Sin movimientos vinculados.</li>'}</ul>`;return;}
    if(edit){const c=appState.clients.find(x=>x.id===edit.dataset.clientEdit);Object.entries(c).forEach(([k,v])=>{if(form.elements[k])form.elements[k].value=v??'';});root.querySelector('#client-form-title').textContent='Editar registro';}
    if(del){if(!confirm('¿Eliminar este registro? Las ventas y consignaciones existentes se conservan.'))return;appState.clients=appState.clients.filter(c=>c.id!==del.dataset.clientDelete);saveAppState();renderManagementView(root,'clients');notify('Registro eliminado.');}
  });
}
function attachSales(root) {
  const form=root.querySelector('#sale-form'), jobSel=form.elements.jobId, prodSel=form.elements.productoId, variantSel=form.elements.variantId;
  const refreshSaleVariants=()=>{const p=getProduct(prodSel.value);const variants=getProductVariants(p);variantSel.innerHTML='<option value="">'+(variants.length?'Selecciona variante':'Sin variante')+'</option>'+variants.map(v=>'<option value="'+esc(v.id)+'">'+esc(v.nombre)+' · '+esc(v.codigo)+'</option>').join('');variantSel.required=variants.length>0;};
  prodSel.addEventListener('change',refreshSaleVariants);refreshSaleVariants();
  function updatePrice(){
    const job=getJob(jobSel.value);if(!job)return;
    const amount=Number(job.calc?.precioUnitario||job.calc?.precioVenta||0);
    if(!form.elements.monto.value)form.elements.monto.value=(amount*Number(form.elements.cantidad.value||1)).toFixed(2);
    root.querySelector('#sale-stock-help').textContent=`Piezas vendibles del trabajo: ${pieces(job)}. Ventas ya registradas: ${appState.sales.filter(s=>s.jobId===job.id).reduce((n,s)=>n+Number(s.cantidad||1),0)}.`;
  }
  jobSel.addEventListener('change',updatePrice);form.elements.cantidad.addEventListener('input',updatePrice);
  form.addEventListener('submit',async e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const qty=Math.floor(Number(d.cantidad)), amount=Number(d.monto);
    if(!Number.isInteger(qty)||qty<1||!Number.isFinite(amount)||amount<=0){alert('Cantidad o monto no válido.');return;}
    const job=getJob(d.jobId);
    const product=getProduct(d.productoId);
    if(job){
      try{assertJobCanSell(job,qty,appState.sales);}catch(error){alert(error.message);return;}
      if(!product||job.data.productoId!==product.id){alert('El trabajo seleccionado debe estar asignado al producto elegido.');return;}
    }
    const variantId=String(d.variantId||'');
    if(product&&getProductVariants(product).length&&!variantId){alert('Selecciona la variante para registrar la venta.');return;}
    if(product&&variantId&&!getProductVariants(product).some(v=>v.id===variantId)){alert('La variante seleccionada no pertenece al producto.');return;}
    if(job&&variantId){
      try{
        assertJobVariantCanSell(job,variantId,qty,appState.sales);
        assertVariantCanMove(product.id,variantId,qty,appState.jobs,appState.sales,appState.consignments);
      }catch(error){alert(error.message);return;}
    } else if(job&&!variantId&&job.data?.variantId){
      alert('Este trabajo está clasificado en una variante. Selecciona esa variante para registrar la venta.');return;
    } else if(product){
      try{if(variantId)assertVariantCanMove(product.id,variantId,qty,appState.jobs,appState.sales,appState.consignments);else assertProductCanMove(product.id,qty,appState.jobs,appState.sales,appState.consignments);}catch(error){alert(error.message);return;}
    }
    const linkedClient=findClientByName(d.cliente);
    const sale={id:makeId('venta'),clientId:linkedClient?.id||null,jobId:d.jobId||null,jobNombre:job?.data.nombre||'',productoId:d.productoId||null,variantId:variantId||job?.data?.variantId||null,productoNombre:product?.nombre||'',cliente:d.cliente.trim(),cantidad:qty,monto:amount,fecha:d.fecha?new Date(d.fecha+'T12:00:00').getTime():Date.now(),metodoPago:d.metodoPago,vendidoPor:d.vendidoPor.trim(),notas:d.notas.trim(),createdAt:Date.now()};
    appState.sales.push(sale);
    try{
      const persisted=await saveAppState();
      if(!persisted)throw new Error('Firestore no confirmó el registro.');
      pendingSaleProductId=null;pendingSaleJobId=null;
      renderManagementView(root,'sales');notify('Venta registrada y guardada en Firebase.');
    }catch(error){
      appState.sales=appState.sales.filter(item=>item.id!==sale.id);
      alert('No se pudo guardar la venta: '+error.message);
    }
  });
  if(pendingSaleJobId && jobSel.querySelector('option[value="'+pendingSaleJobId+'"]')){
    const job=getJob(pendingSaleJobId);
    jobSel.value=pendingSaleJobId;
    if(job?.data?.productoId && prodSel.querySelector('option[value="'+job.data.productoId+'"]')){prodSel.value=job.data.productoId;refreshSaleVariants();if(job.data.variantId)variantSel.value=job.data.variantId;}
    const unit=Number(job?.calc?.precioUnitario||job?.calc?.precioVenta||0);
    if(unit>0)form.elements.monto.value=unit.toFixed(2);
    updatePrice();
    root.querySelector('#sale-stock-help').textContent=`Venta de ${job?.data?.nombre||'trabajo'} · ${pieces(job)} piezas vendibles.`;
    pendingSaleJobId=null;
  } else if(pendingSaleProductId && prodSel.querySelector('option[value="'+pendingSaleProductId+'"]')){prodSel.value=pendingSaleProductId;const product=getProduct(pendingSaleProductId);const stock=stockFor(pendingSaleProductId);const latestJob=jobIdsFor(pendingSaleProductId).sort((a,b)=>Number(b.createdAt||b.data?.fecha||0)-Number(a.createdAt||a.data?.fecha||0))[0];const unit=latestJob?Number(latestJob.calc?.precioUnitario||latestJob.calc?.precioVenta||0):0;if(unit>0&&!form.elements.monto.value)form.elements.monto.value=unit.toFixed(2);root.querySelector('#sale-stock-help').textContent='Venta de '+product.nombre+' · '+stock.available+' unidades disponibles. Ajusta el monto según la cantidad y el precio acordado.';}
  root.querySelector('#sales-table').addEventListener('click',e=>{
    const del=e.target.closest('[data-sale-delete]');if(!del)return;
    if(!confirm('¿Eliminar esta venta? Las piezas volverán a estar disponibles.'))return;
    appState.sales=appState.sales.filter(s=>s.id!==del.dataset.saleDelete);saveAppState();renderManagementView(root,'sales');notify('Venta eliminada.');
  });
  root.querySelector('#sales-print').addEventListener('click',()=>window.print());
  root.querySelector('#sales-csv').addEventListener('click',()=>downloadCsv('ventas.csv',['Fecha','Cliente','Producto','Trabajo','Cantidad','Precio unitario','Monto','Método de pago','Vendido por','Notas'],appState.sales.map(s=>[dateText(s.fecha),s.cliente,s.productoNombre,s.jobNombre,s.cantidad,Number(s.monto||0)/Number(s.cantidad||1),s.monto,s.metodoPago,s.vendidoPor,s.notas])));
}
function attachConsignments(root) {
  const form=root.querySelector('#consignment-form'), productSel=form.elements.productoId, variantSel=form.elements.variantId;
  const refreshConsignmentVariants=()=>{const p=getProduct(productSel.value);const variants=getProductVariants(p);variantSel.innerHTML='<option value="">'+(variants.length?'Selecciona variante':'Sin variante')+'</option>'+variants.map(v=>'<option value="'+esc(v.id)+'">'+esc(v.nombre)+' · '+esc(v.codigo)+'</option>').join('');variantSel.required=variants.length>0;};
  productSel.addEventListener('change',refreshConsignmentVariants);refreshConsignmentVariants();
  productSel.addEventListener('change',()=>{const p=getProduct(productSel.value);if(p)form.elements.productoLibre.value=p.codigo+' — '+p.nombre;});
  form.addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const product=getProduct(d.productoId);
    let qty;
    try{qty=positiveInteger(d.cantidad);}catch(error){alert(error.message);return;}
    const price=Number(d.precioUnitario),paid=Number(d.montoPagado);
    if(!d.tienda.trim()||(!product&&!d.productoLibre.trim())||!Number.isFinite(price)||price<=0||!Number.isFinite(paid)||paid<0||paid>qty*price){alert('Completa tienda, producto, cantidad y valores de pago válidos.');return;}
    const variantId=String(d.variantId||'');
    if(product&&getProductVariants(product).length&&!variantId){alert('Selecciona la variante para consignar.');return;}
    if(product){try{if(variantId)assertVariantCanMove(product.id,variantId,qty,appState.jobs,appState.sales,appState.consignments);else assertProductCanMove(product.id,qty,appState.jobs,appState.sales,appState.consignments);}catch(error){alert(error.message);return;}}
    const consignmentDate=d.fecha?new Date(d.fecha+'T12:00:00').getTime():Date.now();
    const linkedStore=findClientByName(d.tienda,'Tienda');appState.consignments.push({id:makeId('consig'),clientId:linkedStore?.id||null,tienda:d.tienda.trim(),contacto:d.contacto.trim(),productoId:product?.id||null,variantId:variantId||null,productoNombre:product?product.codigo+' — '+product.nombre:d.productoLibre.trim(),cantidad:qty,cantidadDevuelta:0,precioUnitario:price,valorTotal:qty*price,estadoPago:paid===0?'Pendiente':paid===qty*price?'Pagado':'Parcial',montoPagado:paid,pagos:paid>0?[{monto:paid,fecha:consignmentDate,metodoPago:'No especificado'}]:[],fecha:consignmentDate,notas:d.notas.trim(),createdAt:Date.now()});
    saveAppState();renderManagementView(root,'consignments');notify('Entrega registrada.');
  });
  root.querySelector('#consignments-table').addEventListener('click',e=>{
    const pay=e.target.closest('[data-cons-pay]'),ret=e.target.closest('[data-cons-return]'),del=e.target.closest('[data-cons-delete]');
    const c=appState.consignments.find(x=>x.id===(pay?.dataset.consPay||ret?.dataset.consReturn||del?.dataset.consDelete));if(!c)return;
    if(pay){const balance=consignmentBalance(c);const value=prompt(`¿Cuánto pagó ahora? Saldo pendiente: ${money(balance.pending)}`,'');if(value===null)return;const amount=Number(value);if(!Number.isFinite(amount)||amount<=0||amount>balance.pending){alert('El pago debe ser mayor a cero y no superar el saldo pendiente.');return;}if(!Array.isArray(c.pagos))c.pagos=[];c.pagos.push({monto:amount,fecha:Date.now(),metodoPago:'No especificado'});c.montoPagado=Number(c.montoPagado||0)+amount;c.estadoPago=c.montoPagado>=balance.due?'Pagado':'Parcial';}
    if(ret){const left=Math.max(0,c.cantidad-c.cantidadDevuelta);const value=prompt(`Cantidad devuelta sin vender (máximo ${left}):`,'1');if(value===null)return;const amount=Math.floor(Number(value));if(!Number.isInteger(amount)||amount<1||amount>left){alert('Cantidad devuelta no válida.');return;}c.cantidadDevuelta+=amount;const balance=consignmentBalance(c);c.estadoPago=c.montoPagado<=0?'Pendiente':c.montoPagado>=balance.due?'Pagado':'Parcial';}
    if(del){if(c.montoPagado>0&&!confirm('Esta consignación tiene pagos registrados. Al eliminarla se perderá ese historial de cobro. ¿Continuar?'))return;if(!c.montoPagado&&!confirm('¿Eliminar la consignación? Las piezas volverán a estar disponibles.'))return;appState.consignments=appState.consignments.filter(x=>x.id!==c.id);}
    saveAppState();renderManagementView(root,'consignments');notify('Consignación actualizada.');
  });
  renderConsignmentSummary(root.querySelector('#consignment-summary'));
  root.querySelector('#cons-print').addEventListener('click',()=>window.print());
}
function downloadCsv(filename,headers,rows) {
  const cell=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const csv='\uFEFF'+[headers,...rows].map(row=>row.map(cell).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url);
}

export 
function finance() {
  const today=dateValue();
  return `<div class="finance-toolbar management-card">
    <div><h3>Período de análisis</h3><p class="management-help">Los ingresos se calculan con ventas registradas y pagos efectivamente recibidos de consignaciones.</p></div>
    <div class="finance-filters"><label class="management-field">Desde<input type="date" id="finance-from" value="${today.slice(0,7)}-01"></label><label class="management-field">Hasta<input type="date" id="finance-to" value="${today}"></label></div>
  </div>
  <div id="finance-summary" class="management-stats"></div>
  <div class="management-grid">
    <form class="management-card" id="expense-form"><h3>Registrar egreso</h3>
      <label class="management-field">Concepto<input name="concepto" required placeholder="Ej. electricidad del taller"></label>
      <label class="management-field">Categoría<select name="categoria"><option>Electricidad</option><option>Materiales e insumos</option><option>Mantenimiento</option><option>Herramientas y equipos</option><option>Alquiler</option><option>Transporte</option><option>Servicios</option><option>Otros</option></select></label>
      <div class="management-form-row"><label class="management-field">Monto (Bs)<input name="monto" type="number" min="0.01" step="0.01" required></label><label class="management-field">Fecha<input name="fecha" type="date" value="${today}" required></label></div>
      <label class="management-field">Método de pago<select name="metodoPago"><option>Efectivo</option><option>QR</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label>
      <label class="management-field">Notas<textarea name="notas" rows="2"></textarea></label>
      <button class="management-button" type="submit">Guardar egreso</button>
    </form>
    <div class="management-card"><h3>Ingresos y egresos por categoría</h3><div id="finance-breakdown"></div></div>
  </div>
  <div class="management-card"><h3>Movimientos del período</h3><div class="management-table-wrap" id="finance-table"></div><div class="management-actions"><button class="management-button secondary" id="finance-csv">Exportar CSV</button></div></div>`;
}
function financeMovements(from,to) {
  const start=new Date(from+'T00:00:00').getTime(), end=new Date(to+'T23:59:59').getTime();
  const inRange=value=>{const t=typeof value==='number'?value:new Date(value+'T12:00:00').getTime();return Number.isFinite(t)&&t>=start&&t<=end;};
  const rows=[];
  appState.sales.forEach(s=>{if(inRange(s.fecha))rows.push({id:s.id,fecha:s.fecha,tipo:'Ingreso',categoria:'Venta',concepto:'Venta · '+(s.cliente||s.jobNombre||'Sin cliente'),metodo:s.metodoPago||'—',monto:Number(s.monto||0)});});
  appState.consignments.forEach(c=>{
    const payments=Array.isArray(c.pagos)?c.pagos:[];
    payments.forEach((p,i)=>{if(inRange(p.fecha))rows.push({id:c.id+'_p'+i,fecha:p.fecha,tipo:'Ingreso',categoria:'Consignación',concepto:'Pago · '+(c.tienda||'Tienda')+' · '+(c.productoNombre||''),metodo:p.metodoPago||'—',monto:Number(p.monto||0)});});

  });
  appState.expenses.forEach(x=>{if(inRange(x.fecha))rows.push({id:x.id,fecha:x.fecha,tipo:'Egreso',categoria:x.categoria||'Otros',concepto:x.concepto,metodo:x.metodoPago||'—',monto:Number(x.monto||0)});});
  return rows.sort((a,b)=>Number(b.fecha)-Number(a.fecha));
}
function attachFinance(root) {
  const from=root.querySelector('#finance-from'),to=root.querySelector('#finance-to');
  function refresh(){
    if(from.value>to.value){root.querySelector('#finance-summary').innerHTML='<p class="management-help">La fecha inicial no puede ser posterior a la fecha final.</p>';return;}
    const rows=financeMovements(from.value,to.value);
    const income=rows.filter(x=>x.tipo==='Ingreso').reduce((n,x)=>n+x.monto,0);
    const expense=rows.filter(x=>x.tipo==='Egreso').reduce((n,x)=>n+x.monto,0);
    const sales=rows.filter(x=>x.categoria==='Venta').reduce((n,x)=>n+x.monto,0);
    const cons=rows.filter(x=>x.categoria==='Consignación').reduce((n,x)=>n+x.monto,0);
    root.querySelector('#finance-summary').innerHTML=`<article><span>INGRESOS COBRADOS</span><strong>${money(income)}</strong></article><article><span>EGRESOS</span><strong>${money(expense)}</strong></article><article><span>SALDO NETO</span><strong class="${income-expense>=0?'finance-positive':'finance-negative'}">${money(income-expense)}</strong></article><article><span>VENTAS / CONSIGNACIONES</span><strong>${money(sales)} / ${money(cons)}</strong></article>`;
    const categories=new Map();rows.filter(x=>x.tipo==='Egreso').forEach(x=>categories.set(x.categoria,(categories.get(x.categoria)||0)+x.monto));
    root.querySelector('#finance-breakdown').innerHTML=categories.size?[...categories].sort((a,b)=>b[1]-a[1]).map(([name,value])=>`<div class="summary-row"><b>${esc(name)}</b><span>${money(value)}</span></div>`).join(''):'<p class="management-empty">No hay egresos en este período.</p>';
    root.querySelector('#finance-table').innerHTML=rows.length?`<table class="management-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th>Concepto</th><th>Método</th><th>Monto</th><th></th></tr></thead><tbody>${rows.map(x=>`<tr><td>${dateText(x.fecha)}</td><td><b class="${x.tipo==='Ingreso'?'finance-positive':'finance-negative'}">${x.tipo}</b></td><td>${esc(x.categoria)}</td><td>${esc(x.concepto)}</td><td>${esc(x.metodo)}</td><td><b>${money(x.monto)}</b></td><td>${x.tipo==='Egreso'?'<button class="management-link danger" data-expense-delete="'+esc(x.id)+'">Eliminar</button>':'—'}</td></tr>`).join('')}</tbody></table>`:'<p class="management-empty">No hay movimientos en este período.</p>';
    root.querySelector('#finance-csv').onclick=()=>downloadCsv('finanzas.csv',['Fecha','Tipo','Categoría','Concepto','Método','Monto'],rows.map(x=>[dateText(x.fecha),x.tipo,x.categoria,x.concepto,x.metodo,x.monto]));
  }
  from.addEventListener('change',refresh);to.addEventListener('change',refresh);
  root.querySelector('#expense-form').addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(e.currentTarget)),amount=Number(d.monto);
    if(!d.concepto.trim()||!Number.isFinite(amount)||amount<=0){alert('Ingresa un concepto y monto válido.');return;}
    appState.expenses.push({id:makeId('egreso'),concepto:d.concepto.trim(),categoria:d.categoria,monto:amount,fecha:new Date(d.fecha+'T12:00:00').getTime(),metodoPago:d.metodoPago,notas:d.notas.trim(),createdAt:Date.now()});
    saveAppState();renderManagementView(root,'finance');notify('Egreso registrado.');
  });
  root.querySelector('#finance-table').addEventListener('click',e=>{
    const del=e.target.closest('[data-expense-delete]');if(!del)return;
    if(!confirm('¿Eliminar este egreso del registro financiero?'))return;
    appState.expenses=appState.expenses.filter(x=>x.id!==del.dataset.expenseDelete);saveAppState();refresh();notify('Egreso eliminado.');
  });
  refresh();
}

export function renderManagementView(container, section='dashboard') {
  active=section;container.innerHTML=shell(section);
  attachBackup(container);
  if(section==='products'){renderProductsTable(container.querySelector('#products-table'));attachProducts(container);}
  if(section==='clients'){renderClientsTable(container.querySelector('#clients-table'));attachClients(container);}
  if(section==='sales'){renderSalesTable(container.querySelector('#sales-table'));attachSales(container);}
  if(section==='consignments'){renderConsignments(container.querySelector('#consignments-table'));attachConsignments(container);}
  if(section==='finance')attachFinance(container);
  if(section==='settings')attachSettings(container);
}