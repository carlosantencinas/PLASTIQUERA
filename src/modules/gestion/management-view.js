import JsBarcode from 'jsbarcode';
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
  return `<div class="product-workspace">
    <details class="management-card product-editor" id="product-editor">
      <summary><span><b id="product-form-title">Nuevo producto</b><small>Crear o editar una ficha del catálogo</small></span><span class="product-editor-plus">+</span></summary>
      <form id="product-form">
        <input type="hidden" name="id">
        <label class="management-field">Tipo de producto<select name="tipo">${PRODUCT_TYPES.map(([code,label])=>`<option value="${code}">${label} (${code})</option>`).join('')}</select></label>
        <label class="management-field">Código único<input name="codigo" required placeholder="AM3D-ACC-0001"></label>
        <label class="management-field">Nombre<input name="nombre" required placeholder="Nombre del producto"></label>
        <label class="management-field">Notas<textarea name="notas" rows="2" placeholder="Descripción general del modelo"></textarea></label>
        <div class="management-actions"><button class="management-button" type="submit">Guardar producto</button><button class="management-button secondary" type="reset" id="product-reset">Limpiar</button></div>
      </form>
    </details>
    <section class="management-card product-catalog-card">
      <div class="product-catalog-heading"><div><p class="eyebrow">CATÁLOGO AM3D</p><h3>Productos</h3><p>Una ficha por modelo; variantes, existencias y etiquetas dentro de cada producto.</p></div><span class="product-count">${appState.products.length} modelos</span></div>
      <div class="management-search-wrap"><input class="management-search" id="product-search" type="search" placeholder="Buscar por código, nombre o variante…"></div>
      <div id="products-table" class="product-card-list"></div>
    </section>
  </div>
  <details class="management-card product-secondary-section">
    <summary><span>Trabajos y asignaciones</span><small>Vincular trabajos, registrar reimpresiones y revisar producción</small></summary>
    <div class="product-operations-grid">
      <section><h4>Trabajos realizados y reimpresiones</h4><div id="completed-jobs-table" class="management-table-wrap"></div></section>
      <section><h4>Asignación general de trabajos</h4><div id="product-assignments"></div></section>
    </div>
  </details>`;
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
function renderCompletedJobs(root) {
  const completed = appState.jobs.filter(job => !job.data?.estadoTrabajo || job.data.estadoTrabajo === 'realizado')
    .sort((a,b) => Number(b.createdAt || b.updatedAt || b.data?.fecha || 0) - Number(a.createdAt || a.updatedAt || a.data?.fecha || 0));
  if (!completed.length) {
    root.innerHTML = '<p class="management-empty">Todavía no hay trabajos realizados. Cuando marques un trabajo como realizado aparecerá aquí automáticamente.</p>';
    return;
  }
  root.innerHTML = `<table class="management-table production-jobs-table"><thead><tr>
    <th>Trabajo realizado</th><th>Producción</th><th>Vendidas</th><th>No vendidas</th><th>Estado</th><th>Producto / código</th><th>Acciones</th>
  </tr></thead><tbody>${completed.map(job => {
    const quantity = pieces(job);
    const sold = appState.sales.filter(sale => sale.jobId === job.id).reduce((sum,sale) => sum + Number(sale.cantidad || 1),0);
    const available = Math.max(0,quantity-sold);
    const product = getProduct(job.data.productoId);
    const soldItems = appState.sales.filter(sale => sale.jobId === job.id);
    const soldDetail = soldItems.length ? soldItems.map(sale => dateText(sale.fecha)+' · '+(sale.cliente||'Sin cliente')+' · '+(sale.cantidad||1)+' pza · '+money(sale.monto)).join(' | ') : 'Sin ventas registradas';
    const status = available === 0 ? ['agotado','Agotado'] : sold > 0 ? ['parcial','Disponible parcial'] : ['available','Disponible'];
    const selectedCategory = product?.tipo || 'ACC';
    const prefix = PRODUCT_TYPES.some(([code])=>code===selectedCategory) ? selectedCategory : 'ACC';
    return `<tr>
      <td><b>${esc(job.data.nombre)}</b><small>${esc(job.data.cliente || 'Sin cliente')} · ${dateText(job.data.fecha)}</small></td>
      <td><b>${quantity}</b> piezas</td><td>${sold}</td><td><b>${available}</b></td>
      <td><span class="production-status production-status-${status[0]}" title="${esc('Ventas: '+soldDetail+' · Vendidas: '+sold+' · Disponibles: '+available)}">${status[1]} ⓘ</span><div class="production-stock-bar" title="Vendidas: ${sold} · Disponibles: ${available}"><i style="width:${quantity ? sold/quantity*100 : 0}%"></i></div></td>
      <td>${product ? `<b>${esc(product.codigo)}</b><small>${esc(product.nombre)}</small>` : '<span class="production-status production-status-unassigned">Sin clasificar</span>'}</td>
      <td><div class="production-assignment">
        <select data-existing-product="${esc(job.id)}" aria-label="Producto existente para ${esc(job.data.nombre)}">
          <option value="">Asignar producto existente</option>${appState.products.map(p=>`<option value="${esc(p.id)}" ${product?.id===p.id?'selected':''}>${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}
        </select>
        <select data-existing-variant="${esc(job.id)}" aria-label="Variante de ${esc(job.data.nombre)}"><option value="">Sin variante</option>${getProductVariants(product).map(v=>'<option value="'+esc(v.id)+'" '+(job.data.variantId===v.id?'selected':'')+'>'+esc(v.nombre)+' · '+esc(v.codigo)+'</option>').join('')}</select><button type="button" class="management-link" data-assign-existing="${esc(job.id)}">Asignar</button>
        <details class="production-new-product">
          <summary>Crear código nuevo</summary>
          <div class="production-new-fields">
            <input data-new-name="${esc(job.id)}" value="${esc(job.data.nombre)}" aria-label="Nombre del producto" placeholder="Nombre del producto">
            <select data-new-type="${esc(job.id)}" aria-label="Tipo de producto">${PRODUCT_TYPES.map(([code,label])=>`<option value="${code}" ${prefix===code?'selected':''}>${label}</option>`).join('')}</select>
            <input data-new-code="${esc(job.id)}" value="${nextProductCode(prefix)}" aria-label="Código del producto">
            <button type="button" class="management-button" data-create-assign="${esc(job.id)}">Crear y asignar</button>
          </div>
        </details>
        ${available > 0 ? `<button type="button" class="management-button product-quick-sale" data-sell-job="${esc(job.id)}">Vender</button>` : ''}
        <button type="button" class="management-link" data-production-batch="${esc(job.id)}">Registrar reimpresión</button>
        ${(Array.isArray(job.data.productionBatches)?job.data.productionBatches:[]).length ? '<details class="production-batch-history"><summary>Historial de reimpresiones ('+job.data.productionBatches.length+')</summary><ul>'+job.data.productionBatches.map(batch=>{const consumed=(batch.materialConsumptions||[]).map(row=>{const material=inventoryState.materials.find(item=>item.id===row.materialId);return esc(material?.nombre||'Material histórico')+' '+Number(row.grams||0).toFixed(1)+' g';}).join(', ')||'Sin consumo detallado';return '<li><b>'+dateText(batch.date)+'</b> · '+Number(batch.producedQuantity||0)+' producidas · '+(batch.variantName?'Variante: '+esc(batch.variantName)+' · ':'')+' · '+Number(batch.failedQuantity||0)+' fallidas · '+Number(batch.sellableQuantity||0)+' vendibles · '+(batch.status==='reversed'?'Revertido':'Activo')+'<small>'+consumed+'</small>'+(batch.status==='reversed'?'':' <button type="button" class="management-link danger" data-reverse-production-batch="'+esc(job.id)+'" data-batch-id="'+esc(batch.id)+'">Revertir lote</button>')+'</li>';}).join('')+'</ul></details>' : ''}
      </div></td>
    </tr>`;
  }).join('')}</tbody></table>`;
}
function printProductBarcode(product, variant = null) {
  const code = String(variant?.codigo || product?.codigo || '').trim();
  const labelName = variant ? product.nombre + ' · ' + variant.nombre : product?.nombre;
  if (!code) { alert('Este registro no tiene un código interno. Asígnale uno antes de generar la etiqueta.'); return; }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('xmlns', ns); svg.setAttribute('width', '70mm');
  svg.setAttribute('height', '40mm'); svg.setAttribute('viewBox', '0 0 700 400');
  svg.setAttribute('version', '1.1');
  const textNode = (x, y, value, size, weight = 'normal') => {
    const node = document.createElementNS(ns, 'text');
    node.setAttribute('x', x); node.setAttribute('y', y);
    node.setAttribute('text-anchor', 'middle');
    node.setAttribute('font-family', 'Arial, sans-serif');
    node.setAttribute('font-size', size); node.setAttribute('font-weight', weight);
    node.textContent = value; svg.append(node);
  };
  const border = document.createElementNS(ns, 'rect');
  border.setAttribute('x', '5'); border.setAttribute('y', '5');
  border.setAttribute('width', '690'); border.setAttribute('height', '390');
  border.setAttribute('fill', '#fff'); border.setAttribute('stroke', '#aaa');
  border.setAttribute('stroke-dasharray', '8 6'); border.setAttribute('stroke-width', '2');
  svg.append(border);
  textNode(350, 75, String(labelName || 'Producto').slice(0, 60), 30, 'bold');
  const barcode = document.createElementNS(ns, 'svg');
  barcode.setAttribute('x', '70'); barcode.setAttribute('y', '105');
  barcode.setAttribute('width', '560'); barcode.setAttribute('height', '190');
  barcode.setAttribute('viewBox', '0 0 600 200'); barcode.setAttribute('preserveAspectRatio', 'none');
  svg.append(barcode);
  try { JsBarcode(barcode, code, { format: 'CODE128', displayValue: false, margin: 2, height: 150, width: 2 }); }
  catch (error) { alert('No se pudo generar el código de barras: ' + error.message); return; }
  textNode(350, 340, code, 28, 'bold');
  textNode(350, 375, 'AM3D · CODE 128 · ' + (variant ? 'VARIANTE' : 'PRODUCTO'), 17);
  const serialized = new XMLSerializer().serializeToString(svg);
  const blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\\n' + serialized], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'etiqueta-' + code.replace(/[^a-z0-9_-]/gi, '-') + '.svg';
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function renderProductsTable(root, query='') {
  const q=String(query||'').trim().toLocaleLowerCase('es');
  const products=appState.products.filter(p=>{
    const variants=getProductVariants(p);
    return [p.nombre,p.codigo,p.tipo,p.notas,...variants.flatMap(v=>[v.nombre,v.codigo])].join(' ').toLocaleLowerCase('es').includes(q);
  });
  if (!products.length) {
    root.innerHTML=appState.products.length?'<p class="management-empty">No hay productos que coincidan con la búsqueda.</p>':'<p class="management-empty">Todavía no hay productos. Pulsa “Nuevo producto” para crear el primero.</p>';
    return;
  }
  root.innerHTML=products.map(p=>{
    const stock=stockFor(p.id), variants=getProductVariants(p);
    const variantRows=variants.map(v=>{
      const vs=getProductVariantStock(p.id,v.id,appState.jobs,appState.sales,appState.consignments);
      const materialNames=(v.materialIds||[]).map(id=>inventoryState.materials.find(item=>item.id===id)?.nombre).filter(Boolean).join(' + ');
      return `<div class="product-variant-row">
        <span class="product-variant-swatch" aria-hidden="true"></span>
        <span class="product-variant-info"><b>${esc(v.nombre)}</b><code>${esc(v.codigo)}</code><small>${materialNames?esc(materialNames)+' · ':''}${vs.available} disponibles <i>·</i> ${vs.produced} producidas <i>·</i> ${vs.sold} vendidas <i>·</i> ${vs.consigned} en tienda</small></span>
        <button type="button" class="management-link" data-variant-barcode="${esc(p.id)}" data-variant-id="${esc(v.id)}">Etiqueta</button>
      </div>`;
    }).join('');
    const type=PRODUCT_TYPES.find(([code])=>code===p.tipo)?.[1]||p.tipo||'Sin clasificar';
    return `<article class="product-catalog-item" data-product-card>
      <div class="product-card-main">
        <div class="product-card-identity"><span class="product-type-label">${esc(type)}</span><h4>${esc(p.nombre)}</h4><code>${esc(p.codigo)}</code>${p.notas?`<p>${esc(p.notas)}</p>`:''}</div>
        <div class="product-stock-summary"><b>${stock.available}</b><span>disponibles</span><small>${stock.produced} producidas</small></div>
      </div>
      <div class="product-card-footer">
        <details class="product-variant-details"><summary>Variantes <b>${variants.length}</b></summary><div class="product-variant-list">${variantRows||'<p class="management-empty">Aún no hay variantes individuales.</p>'}</div><button type="button" class="management-link product-add-variant" data-variant-add="${esc(p.id)}">+ Añadir variante</button></details>
        <div class="product-card-actions"><button class="management-link" data-product-barcode="${esc(p.id)}">Etiqueta general</button><button class="management-link" data-product-edit="${esc(p.id)}">Editar</button><button class="management-link danger" data-product-delete="${esc(p.id)}">Eliminar</button></div>
      </div>
    </article>`;
  }).join('');
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
function attachProducts(root) {
  const form=root.querySelector('#product-form');
  form.addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const code=String(d.codigo||'').trim();const name=String(d.nombre||'').trim();
    if(!code||!name){alert('El código y el nombre del producto son obligatorios.');return;}
    if(!isProductCodeAvailable(code,appState.products,{productId:d.id||null,kind:'product'})){alert('Ese código ya está utilizado por otro producto o variante.');return;}
    if(d.id){const product=getProduct(d.id);if(!product){alert('No se encontró el producto que intentas editar. Actualiza la vista y vuelve a intentarlo.');return;}Object.assign(product,{codigo:code,tipo:d.tipo,nombre,notas:String(d.notas||'').trim()});}
    else appState.products.push({id:makeId('prod'),codigo:code,tipo:d.tipo,nombre,notas:String(d.notas||'').trim(),createdAt:Date.now()});
    saveAppState();renderManagementView(root,'products');notify('Producto guardado.');
  });
  root.querySelector('#product-search').addEventListener('input',e=>renderProductsTable(root.querySelector('#products-table'),e.target.value));
  root.querySelector('#products-table').addEventListener('click',e=>{
    const edit=e.target.closest('[data-product-edit]'),del=e.target.closest('[data-product-delete]'),barcode=e.target.closest('[data-product-barcode]');
    const addVariant=e.target.closest('[data-variant-add]'),variantBarcode=e.target.closest('[data-variant-barcode]');
    if(barcode){const product=getProduct(barcode.dataset.productBarcode);if(product)printProductBarcode(product);}
    if(variantBarcode){const product=getProduct(variantBarcode.dataset.variantBarcode);const variant=getProductVariants(product).find(item=>item.id===variantBarcode.dataset.variantId);if(product&&variant)printProductBarcode(product,variant);}
    if(addVariant){
      const product=getProduct(addVariant.dataset.variantAdd);if(!product)return;
      const name=prompt('Nombre de la variante (por ejemplo, Negro):');if(name===null)return;
      const code=prompt('Código/SKU único de esta variante (por ejemplo, '+product.codigo+'-NEG):');if(code===null)return;
      try{
        const values=validateVariantInput({code,name},appState.products);
        if(!Array.isArray(product.variantes))product.variantes=[];
        product.variantes.push({id:makeId('var'),...values,activo:true,createdAt:Date.now()});
        saveAppState();renderManagementView(root,'products');notify('Variante guardada. Ya puedes imprimir su etiqueta individual.');
      }catch(error){alert(error.message);}
      return;
    }
    if(edit){const p=getProduct(edit.dataset.productEdit);root.querySelector('#product-editor').open=true;form.elements.id.value=p.id;form.elements.tipo.value=p.tipo||'ACC';form.elements.codigo.value=p.codigo;form.elements.nombre.value=p.nombre;form.elements.notas.value=p.notas||'';root.querySelector('#product-form-title').textContent='Editar producto';}
    if(del){const id=del.dataset.productDelete;
      const hasSales=appState.sales.some(s=>s.productoId===id);
      const hasConsignments=appState.consignments.some(c=>c.productoId===id);
      const hasJobs=appState.jobs.some(j=>j.data?.productoId===id);
      if(hasSales||hasConsignments||hasJobs){alert('No se puede eliminar este producto porque tiene historial comercial o trabajos vinculados. Para conservar la trazabilidad, mantenlo en el catálogo; más adelante se podrá marcar como inactivo.');return;}
      if(!confirm('¿Eliminar este producto sin movimientos ni trabajos asociados?'))return;
      appState.products=appState.products.filter(p=>p.id!==id);saveAppState();renderManagementView(root,'products');notify('Producto eliminado.');}
  });
  root.querySelector('#completed-jobs-table').addEventListener('change',e=>{
    const productSelect=e.target.closest('[data-existing-product]');
    if(productSelect){const jobId=productSelect.dataset.existingProduct;const product=getProduct(productSelect.value);const variantSelect=root.querySelector('[data-existing-variant="'+jobId+'"]');if(variantSelect){variantSelect.innerHTML='<option value="">Sin variante</option>'+getProductVariants(product).map(v=>'<option value="'+esc(v.id)+'">'+esc(v.nombre)+' · '+esc(v.codigo)+'</option>').join('');}return;}
    const type=e.target.closest('[data-new-type]');
    if(type){
      const codeField=root.querySelector('[data-new-code="'+type.dataset.newType+'"]');
      if(codeField)codeField.value=nextProductCode(type.value);
    }
  });
  root.querySelector('#completed-jobs-table').addEventListener('click',async e=>{
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
    if(sellJob){
      const job=getJob(sellJob.dataset.sellJob);
      if(!job)return;
      pendingSaleJobId=job.id;
      pendingSaleProductId=job.data?.productoId||null;
      location.hash='#ventas';
      renderManagementView(document.querySelector('#management-root'),'sales');
      const saleForm=document.querySelector('#management-root #sale-form');
      if(saleForm){
        saleForm.elements.jobId.value=job.id;
        if(pendingSaleProductId)saleForm.elements.productoId.value=pendingSaleProductId;
        const unit=Number(job.calc?.precioUnitario||job.calc?.precioVenta||0);
        if(unit>0)saleForm.elements.monto.value=unit.toFixed(2);
        saleForm.elements.cantidad.focus();
      }
      return;
    }
    if(assign){
      const job=getJob(assign.dataset.assignExisting);
      const select=root.querySelector('[data-existing-product="'+assign.dataset.assignExisting+'"]');
      const productId=String(select?.value||'');
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
        renderCompletedJobs(root.querySelector('#completed-jobs-table'));
        renderProductsTable(root.querySelector('#products-table'));
        renderAssignments(root.querySelector('#product-assignments'));
        notify('Trabajo asignado y guardado en Firebase.');
      }catch(error){
        job.data.productoId=previousProductId;
        job.data.variantId=previousVariantId;
        alert('No se pudo guardar la asignación: '+error.message);
        renderCompletedJobs(root.querySelector('#completed-jobs-table'));
        renderProductsTable(root.querySelector('#products-table'));
      }
    }
    if(create){
      const job=getJob(create.dataset.createAssign);
      const name=root.querySelector('[data-new-name="'+create.dataset.createAssign+'"]')?.value.trim();
      const type=root.querySelector('[data-new-type="'+create.dataset.createAssign+'"]')?.value;
      const code=root.querySelector('[data-new-code="'+create.dataset.createAssign+'"]')?.value.trim();
      if(!job||!name||!code||!PRODUCT_TYPES.some(([prefix])=>prefix===type)){alert('Completa el nombre, tipo y código del producto.');return;}
      if(appState.products.some(p=>String(p.codigo).toLowerCase()===code.toLowerCase())){alert('Ese código ya existe. Usa otro código.');return;}
      const product={id:makeId('prod'),codigo:code,nombre:name,notas:'Creado desde trabajo realizado: '+job.data.nombre,tipo:type,createdAt:Date.now()};
      appState.products.push(product);job.data.productoId=product.id;
      saveAppState();renderManagementView(root,'products');notify('Producto creado y trabajo asignado.');
    }
  });
  root.querySelector('#product-assignments').addEventListener('change',e=>{
    const sel=e.target.closest('[data-job-product]');if(!sel)return;
    const job=getJob(sel.dataset.jobProduct);if(job)job.data.productoId=sel.value||null;
  });
  root.querySelector('#product-assignments').addEventListener('click',e=>{
    if(e.target.id==='save-assignments'){saveAppState();renderManagementView(root,'products');notify('Asignaciones guardadas.');}
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
  if(section==='products'){renderCompletedJobs(container.querySelector('#completed-jobs-table'));renderProductsTable(container.querySelector('#products-table'));renderAssignments(container.querySelector('#product-assignments'));attachProducts(container);}
  if(section==='clients'){renderClientsTable(container.querySelector('#clients-table'));attachClients(container);}
  if(section==='sales'){renderSalesTable(container.querySelector('#sales-table'));attachSales(container);}
  if(section==='consignments'){renderConsignments(container.querySelector('#consignments-table'));attachConsignments(container);}
  if(section==='finance')attachFinance(container);
  if(section==='settings')attachSettings(container);
}
