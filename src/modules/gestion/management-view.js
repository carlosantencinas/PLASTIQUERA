import { appState, saveAppState, exportBackup, importBackup, makeId } from '../../services/app-store.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = value => 'Bs ' + Number(value || 0).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateText = value => value ? new Date(value).toLocaleDateString('es-BO') : '—';
const dateValue = value => { const d = value ? new Date(value) : new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
const pieces = job => Math.max(0, Number(job?.data?.piezasVendibles ?? 1));
const jobIdsFor = productId => appState.jobs.filter(j => j.data?.productoId === productId);
const soldFor = productId => {
  const ids = new Set(jobIdsFor(productId).map(j => j.id));
  return appState.sales.filter(s => s.productoId === productId || ids.has(s.jobId)).reduce((n,s) => n + Number(s.cantidad || 1),0);
};
const consignedFor = productId => appState.consignments.filter(c => c.productoId === productId).reduce((n,c) => n + Math.max(0,Number(c.cantidad || 0)-Number(c.cantidadDevuelta || 0)),0);
const availableFor = productId => Math.max(0,jobIdsFor(productId).reduce((n,j)=>n+pieces(j),0)-soldFor(productId)-consignedFor(productId));
const getProduct = id => appState.products.find(p => p.id === id);
const getJob = id => appState.jobs.find(j => j.id === id);
const notify = message => { const node=document.querySelector('#management-message'); if(node){node.textContent=message;node.hidden=false;setTimeout(()=>node.hidden=true,2600);} };
const moneyInput = value => Number(value || 0);

let active = 'dashboard';

function shell(section) {
  const titles = {dashboard:'Panel principal',products:'Productos',clients:'Clientes',sales:'Ventas',consignments:'Consignaciones'};
  return `
  <section class="management-module">
    <div class="management-heading"><div><p class="eyebrow">GESTIÓN COMERCIAL</p><h2>${titles[section]}</h2><p>Registros relacionados con la producción, los clientes y la venta de productos.</p></div><span class="local-data-tag">Datos guardados en este navegador</span></div>
    <div id="management-message" class="management-message" hidden role="status"></div>
    ${section==='dashboard'?dashboard():section==='products'?products():section==='clients'?clients():section==='sales'?sales():consignments()}
    <section class="backup-panel"><div><strong>Respaldo de datos</strong><p>Exporta periódicamente un archivo JSON. La importación reemplaza los datos locales actuales.</p></div><div class="backup-actions"><button type="button" class="management-button secondary" id="backup-export">Exportar respaldo</button><label class="management-button secondary file-button">Importar respaldo<input type="file" id="backup-import" accept=".json,application/json" hidden></label></div></section>
  </section>`;
}

function dashboard() {
  const totalJobs=appState.jobs.length, totalSales=appState.sales.reduce((n,s)=>n+Number(s.monto||0),0);
  const pending=appState.consignments.reduce((n,c)=>n+Math.max(0,(Number(c.cantidad||0)-Number(c.cantidadDevuelta||0))*Number(c.precioUnitario||0)-Number(c.montoPagado||0)),0);
  const sellable=appState.jobs.reduce((n,j)=>n+pieces(j),0);
  return `<div class="management-stats">
    <article><span>TRABAJOS</span><strong>${totalJobs}</strong></article>
    <article><span>PRODUCTOS</span><strong>${appState.products.length}</strong></article>
    <article><span>VENTAS REGISTRADAS</span><strong>${money(totalSales)}</strong></article>
    <article><span>POR COBRAR EN CONSIGNACIÓN</span><strong>${money(pending)}</strong></article>
  </div>
  <div class="management-card"><h3>Resumen de operación</h3><div class="management-summary-grid">
    <div><span>Piezas vendibles registradas</span><b>${sellable}</b></div>
    <div><span>Clientes y tiendas</span><b>${appState.clients.length}</b></div>
    <div><span>Ventas registradas</span><b>${appState.sales.length}</b></div>
    <div><span>Entregas en consignación</span><b>${appState.consignments.length}</b></div>
  </div><p class="management-help">El stock de productos se calcula a partir de piezas vendibles en trabajos, ventas directas y unidades que permanecen en tiendas. Las piezas devueltas se liberan nuevamente.</p></div>`;
}

function products() {
  return `<div class="management-grid">
    <form class="management-card" id="product-form"><h3 id="product-form-title">Crear producto</h3>
      <input type="hidden" name="id">
      <label class="management-field">Código único<input name="codigo" required placeholder="P-001"></label>
      <label class="management-field">Nombre<input name="nombre" required placeholder="Nombre del producto"></label>
      <label class="management-field">Notas<textarea name="notas" rows="3" placeholder="Variantes, color, tamaño…"></textarea></label>
      <div class="management-actions"><button class="management-button" type="submit">Guardar producto</button><button class="management-button secondary" type="reset" id="product-reset">Limpiar</button></div>
      <p class="management-help">Asigna trabajos desde la tabla inferior. Un trabajo sólo puede pertenecer a un producto.</p>
    </form>
    <div class="management-card"><h3>Catálogo y existencias</h3><div class="management-table-wrap" id="products-table"></div></div>
  </div>
  <div class="management-card"><h3>Asignar trabajos a productos</h3><div id="product-assignments"></div></div>`;
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
    <div class="management-card"><h3>Directorio</h3><input class="management-search" id="client-search" placeholder="Buscar por nombre, teléfono o notas"><div id="clients-table" class="management-table-wrap"></div></div>
  </div>`;
}

function sales() {
  return `<div class="management-grid">
    <form class="management-card" id="sale-form"><h3>Registrar venta</h3>
      <label class="management-field">Trabajo asociado<select name="jobId" id="sale-job"><option value="">Venta independiente / sin trabajo</option>${appState.jobs.map(j=>`<option value="${esc(j.id)}">${esc(j.data.nombre)} — ${money(j.calc?.precioUnitario || j.calc?.precioVenta)}</option>`).join('')}</select></label>
      <label class="management-field">Producto (opcional)<select name="productoId" id="sale-product"><option value="">Sin producto</option>${appState.products.map(p=>`<option value="${esc(p.id)}">${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}</select></label>
      <label class="management-field">Cliente<input name="cliente" list="management-clients" placeholder="Nombre del cliente"><datalist id="management-clients">${appState.clients.map(c=>`<option value="${esc(c.nombre)}"></option>`).join('')}</datalist></label>
      <div class="management-form-row"><label class="management-field">Cantidad<input name="cantidad" type="number" min="1" step="1" value="1" required></label><label class="management-field">Monto (Bs)<input name="monto" type="number" min="0.01" step="0.01" required></label></div>
      <div class="management-form-row"><label class="management-field">Fecha<input name="fecha" type="date" value="${dateValue()}"></label><label class="management-field">Método de pago<select name="metodoPago"><option>Efectivo</option><option>QR</option><option>Transferencia</option><option>Tarjeta</option><option>Otro</option></select></label></div>
      <label class="management-field">Vendido por<input name="vendidoPor"></label><label class="management-field">Notas<textarea name="notas" rows="2"></textarea></label>
      <button class="management-button" type="submit">Guardar venta</button><p class="management-help" id="sale-stock-help">Al asociar un trabajo se validan las piezas restantes y se descuenta la cantidad vendida del stock disponible.</p>
    </form>
    <div class="management-card"><h3>Historial de ventas</h3><div class="management-table-wrap" id="sales-table"></div><div class="management-actions"><button class="management-button secondary" id="sales-print">Imprimir reporte</button><button class="management-button secondary" id="sales-csv">Exportar CSV</button></div></div>
  </div>`;
}

function consignments() {
  return `<div class="management-grid">
    <form class="management-card" id="consignment-form"><h3>Registrar entrega a tienda</h3>
      <label class="management-field">Tienda<input name="tienda" list="management-stores" required><datalist id="management-stores">${appState.clients.filter(c=>c.tipo==='Tienda').map(c=>`<option value="${esc(c.nombre)}"></option>`).join('')}</datalist></label>
      <label class="management-field">Contacto<input name="contacto"></label>
      <label class="management-field">Producto<select name="productoId" id="cons-product"><option value="">Producto libre / sin código</option>${appState.products.map(p=>`<option value="${esc(p.id)}">${esc(p.codigo)} — ${esc(p.nombre)}</option>`).join('')}</select></label>
      <label class="management-field">Descripción libre<input name="productoLibre" placeholder="Descripción si no hay producto"></label>
      <div class="management-form-row"><label class="management-field">Cantidad<input name="cantidad" type="number" min="1" step="1" value="1" required></label><label class="management-field">Precio por unidad (Bs)<input name="precioUnitario" type="number" min="0.01" step="0.01" required></label></div>
      <div class="management-form-row"><label class="management-field">Fecha<input name="fecha" type="date" value="${dateValue()}"></label><label class="management-field">Estado de pago<select name="estadoPago"><option>Pendiente</option><option>Parcial</option><option>Pagado</option></select></label></div>
      <label class="management-field">Notas<textarea name="notas" rows="2"></textarea></label>
      <button class="management-button" type="submit">Registrar entrega</button><p class="management-help" id="cons-stock-help">Las piezas entregadas dejan de estar disponibles en taller hasta que se vendan o devuelvan.</p>
    </form>
    <div class="management-card"><h3>Resumen por tienda</h3><div id="consignment-summary"></div></div>
  </div>
  <div class="management-card"><h3>Historial de consignaciones</h3><div class="management-table-wrap" id="consignments-table"></div><div class="management-actions"><button class="management-button secondary" id="cons-print">Imprimir reporte</button></div></div>`;
}

function renderProductsTable(root) {
  if (!appState.products.length) { root.innerHTML='<p class="management-empty">Todavía no hay productos. Crea el primero para comenzar.</p>'; return; }
  root.innerHTML = `<table class="management-table"><thead><tr><th>Código</th><th>Producto</th><th>Trabajos</th><th>Vendibles</th><th>Vendidas</th><th>En tienda</th><th>Disponibles</th><th></th></tr></thead><tbody>${appState.products.map(p=>{
    const jobs=jobIdsFor(p.id), total=jobs.reduce((n,j)=>n+pieces(j),0), sold=soldFor(p.id), cons=consignedFor(p.id), avail=availableFor(p.id);
    return `<tr><td>${esc(p.codigo)}</td><td><b>${esc(p.nombre)}</b><small>${esc(p.notas)}</small></td><td>${jobs.length}</td><td>${total}</td><td>${sold}</td><td>${cons}</td><td><b>${avail}</b></td><td><button class="management-link" data-product-edit="${esc(p.id)}">Editar</button> <button class="management-link danger" data-product-delete="${esc(p.id)}">Eliminar</button></td></tr>`;
  }).join('')}</tbody></table>`;
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
  root.innerHTML=`<table class="management-table"><thead><tr><th>Tipo</th><th>Nombre</th><th>Teléfono</th><th>Contacto</th><th>Dirección</th><th></th></tr></thead><tbody>${rows.map(c=>`<tr><td>${esc(c.tipo)}</td><td><b>${esc(c.nombre)}</b><small>${esc(c.notas)}</small></td><td>${esc(c.telefono)}</td><td>${esc(c.contacto)}</td><td>${esc(c.direccion)}</td><td><button class="management-link" data-client-edit="${esc(c.id)}">Editar</button> <button class="management-link danger" data-client-delete="${esc(c.id)}">Eliminar</button></td></tr>`).join('')}</tbody></table>`;
}
function renderSalesTable(root) {
  if(!appState.sales.length){root.innerHTML='<p class="management-empty">Todavía no hay ventas registradas.</p>';return;}
  root.innerHTML=`<table class="management-table"><thead><tr><th>Fecha</th><th>Cliente</th><th>Trabajo</th><th>Cantidad</th><th>Método</th><th>Monto</th><th></th></tr></thead><tbody>${[...appState.sales].sort((a,b)=>b.fecha-a.fecha).map(s=>`<tr><td>${dateText(s.fecha)}</td><td>${esc(s.cliente||'Sin cliente')}</td><td>${esc(s.jobNombre||'Independiente')}</td><td>${s.cantidad||1}</td><td>${esc(s.metodoPago)}</td><td><b>${money(s.monto)}</b></td><td><button class="management-link danger" data-sale-delete="${esc(s.id)}">Eliminar</button></td></tr>`).join('')}</tbody></table>`;
}
function renderConsignments(root) {
  if(!appState.consignments.length){root.innerHTML='<p class="management-empty">Todavía no hay entregas registradas.</p>';return;}
  root.innerHTML=`<table class="management-table"><thead><tr><th>Fecha</th><th>Tienda</th><th>Producto</th><th>Entregado</th><th>Devuelto</th><th>A cobrar</th><th>Pagado</th><th></th></tr></thead><tbody>${[...appState.consignments].sort((a,b)=>b.fecha-a.fecha).map(c=>{
    const net=Math.max(0,c.cantidad-(c.cantidadDevuelta||0)), due=net*c.precioUnitario;
    return `<tr><td>${dateText(c.fecha)}</td><td><b>${esc(c.tienda)}</b></td><td>${esc(c.productoNombre)}</td><td>${c.cantidad}</td><td>${c.cantidadDevuelta||0}</td><td>${money(due)}</td><td>${money(c.montoPagado||0)}</td><td><button class="management-link" data-cons-pay="${esc(c.id)}">Pago</button> <button class="management-link" data-cons-return="${esc(c.id)}">Devolución</button> <button class="management-link danger" data-cons-delete="${esc(c.id)}">Eliminar</button></td></tr>`;
  }).join('')}</tbody></table>`;
}
function renderConsignmentSummary(root) {
  const map=new Map();
  appState.consignments.forEach(c=>{const n=Math.max(0,c.cantidad-(c.cantidadDevuelta||0));const row=map.get(c.tienda)||{pieces:0,due:0,paid:0};row.pieces+=n;row.due+=n*c.precioUnitario;row.paid+=Number(c.montoPagado||0);map.set(c.tienda,row);});
  root.innerHTML=map.size?[...map].map(([name,r])=>`<div class="summary-row"><b>${esc(name)}</b><span>${r.pieces} piezas · pendiente ${money(Math.max(0,r.due-r.paid))}</span></div>`).join(''):'<p class="management-empty">Sin entregas aún.</p>';
}

function attachBackup(root) {
  root.querySelector('#backup-export').addEventListener('click',exportBackup);
  root.querySelector('#backup-import').addEventListener('change',async e=>{
    const file=e.target.files?.[0]; if(!file)return;
    if(!confirm('La importación reemplazará todos los datos locales actuales. ¿Continuar?')){e.target.value='';return;}
    try{await importBackup(file);notify('Respaldo importado correctamente.');renderManagementView(root,active);}catch(error){alert(error.message);}
  });
}
function attachProducts(root) {
  const form=root.querySelector('#product-form');
  form.addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const code=d.codigo.trim();
    if(appState.products.some(p=>p.codigo.toLowerCase()===code.toLowerCase()&&p.id!==d.id)){alert('Ese código ya está registrado.');return;}
    if(d.id){Object.assign(getProduct(d.id),{codigo:code,nombre:d.nombre.trim(),notas:d.notas.trim()});}
    else appState.products.push({id:makeId('prod'),codigo,nombre:d.nombre.trim(),notas:d.notas.trim(),createdAt:Date.now()});
    saveAppState();renderManagementView(root,'products');notify('Producto guardado.');
  });
  root.querySelector('#products-table').addEventListener('click',e=>{
    const edit=e.target.closest('[data-product-edit]'),del=e.target.closest('[data-product-delete]');
    if(edit){const p=getProduct(edit.dataset.productEdit);form.elements.id.value=p.id;form.elements.codigo.value=p.codigo;form.elements.nombre.value=p.nombre;form.elements.notas.value=p.notas||'';root.querySelector('#product-form-title').textContent='Editar producto';}
    if(del){const id=del.dataset.productDelete;if(!confirm('¿Eliminar producto? Los trabajos asociados quedarán sin producto.'))return;appState.jobs.forEach(j=>{if(j.data.productoId===id)j.data.productoId=null;});appState.products=appState.products.filter(p=>p.id!==id);saveAppState();renderManagementView(root,'products');notify('Producto eliminado.');}
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
    const edit=e.target.closest('[data-client-edit]'),del=e.target.closest('[data-client-delete]');
    if(edit){const c=appState.clients.find(x=>x.id===edit.dataset.clientEdit);Object.entries(c).forEach(([k,v])=>{if(form.elements[k])form.elements[k].value=v??'';});root.querySelector('#client-form-title').textContent='Editar registro';}
    if(del){if(!confirm('¿Eliminar este registro? Las ventas y consignaciones existentes se conservan.'))return;appState.clients=appState.clients.filter(c=>c.id!==del.dataset.clientDelete);saveAppState();renderManagementView(root,'clients');notify('Registro eliminado.');}
  });
}
function attachSales(root) {
  const form=root.querySelector('#sale-form'), jobSel=form.elements.jobId, prodSel=form.elements.productoId;
  function updatePrice(){
    const job=getJob(jobSel.value);if(!job)return;
    const amount=Number(job.calc?.precioUnitario||job.calc?.precioVenta||0);
    if(!form.elements.monto.value)form.elements.monto.value=(amount*Number(form.elements.cantidad.value||1)).toFixed(2);
    root.querySelector('#sale-stock-help').textContent=`Piezas vendibles del trabajo: ${pieces(job)}. Ventas ya registradas: ${appState.sales.filter(s=>s.jobId===job.id).reduce((n,s)=>n+Number(s.cantidad||1),0)}.`;
  }
  jobSel.addEventListener('change',updatePrice);form.elements.cantidad.addEventListener('input',updatePrice);
  form.addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const qty=Math.floor(Number(d.cantidad)), amount=Number(d.monto);
    if(!Number.isInteger(qty)||qty<1||!Number.isFinite(amount)||amount<=0){alert('Cantidad o monto no válido.');return;}
    const job=getJob(d.jobId);if(job){const remaining=pieces(job)-appState.sales.filter(s=>s.jobId===job.id).reduce((n,s)=>n+Number(s.cantidad||1),0);if(qty>remaining){alert(`No hay suficientes piezas. Disponibles: ${remaining}.`);return;}}
    const product=getProduct(d.productoId);
    if(product&&qty>availableFor(product.id)){alert(`Stock insuficiente del producto. Disponibles: ${availableFor(product.id)}.`);return;}
    const sale={id:makeId('venta'),jobId:d.jobId||null,jobNombre:job?.data.nombre||'',productoId:d.productoId||null,productoNombre:product?.nombre||'',cliente:d.cliente.trim(),cantidad:qty,monto:amount,fecha:d.fecha?new Date(d.fecha+'T12:00:00').getTime():Date.now(),metodoPago:d.metodoPago,vendidoPor:d.vendidoPor.trim(),notas:d.notas.trim(),createdAt:Date.now()};
    appState.sales.push(sale);saveAppState();renderManagementView(root,'sales');notify('Venta registrada.');
  });
  root.querySelector('#sales-table').addEventListener('click',e=>{
    const del=e.target.closest('[data-sale-delete]');if(!del)return;
    if(!confirm('¿Eliminar esta venta? Las piezas volverán a estar disponibles.'))return;
    appState.sales=appState.sales.filter(s=>s.id!==del.dataset.saleDelete);saveAppState();renderManagementView(root,'sales');notify('Venta eliminada.');
  });
  root.querySelector('#sales-print').addEventListener('click',()=>window.print());
  root.querySelector('#sales-csv').addEventListener('click',()=>downloadCsv('ventas.csv',['Fecha','Cliente','Trabajo','Cantidad','Método','Monto'],appState.sales.map(s=>[dateText(s.fecha),s.cliente,s.jobNombre,s.cantidad,s.metodoPago,s.monto])));
}
function attachConsignments(root) {
  const form=root.querySelector('#consignment-form'), productSel=form.elements.productoId;
  productSel.addEventListener('change',()=>{const p=getProduct(productSel.value);if(p)form.elements.productoLibre.value=p.codigo+' — '+p.nombre;});
  form.addEventListener('submit',e=>{
    e.preventDefault();const d=Object.fromEntries(new FormData(form));const product=getProduct(d.productoId);
    const qty=Math.floor(Number(d.cantidad)),price=Number(d.precioUnitario);
    if(!d.tienda.trim()||(!product&&!d.productoLibre.trim())||qty<1||price<=0){alert('Completa tienda, producto, cantidad y precio válido.');return;}
    if(product&&qty>availableFor(product.id)){alert(`No hay stock suficiente. Disponible: ${availableFor(product.id)}.`);return;}
    appState.consignments.push({id:makeId('consig'),tienda:d.tienda.trim(),contacto:d.contacto.trim(),productoId:product?.id||null,productoNombre:product?product.codigo+' — '+product.nombre:d.productoLibre.trim(),cantidad:qty,cantidadDevuelta:0,precioUnitario:price,valorTotal:qty*price,estadoPago:d.estadoPago,montoPagado:d.estadoPago==='Pagado'?qty*price:0,fecha:d.fecha?new Date(d.fecha+'T12:00:00').getTime():Date.now(),notas:d.notas.trim(),createdAt:Date.now()});
    saveAppState();renderManagementView(root,'consignments');notify('Entrega registrada.');
  });
  root.querySelector('#consignments-table').addEventListener('click',e=>{
    const pay=e.target.closest('[data-cons-pay]'),ret=e.target.closest('[data-cons-return]'),del=e.target.closest('[data-cons-delete]');
    const c=appState.consignments.find(x=>x.id===(pay?.dataset.consPay||ret?.dataset.consReturn||del?.dataset.consDelete));if(!c)return;
    if(pay){const net=Math.max(0,c.cantidad-c.cantidadDevuelta)*c.precioUnitario;const value=prompt(`Monto pagado acumulado (máximo ${money(net)}):`,c.montoPagado||0);if(value===null)return;const amount=Number(value);if(!Number.isFinite(amount)||amount<0||amount>net){alert('Monto de pago fuera del rango permitido.');return;}c.montoPagado=amount;c.estadoPago=amount===0?'Pendiente':amount>=net?'Pagado':'Parcial';}
    if(ret){const left=Math.max(0,c.cantidad-c.cantidadDevuelta);const value=prompt(`Cantidad devuelta sin vender (máximo ${left}):`,'1');if(value===null)return;const amount=Math.floor(Number(value));if(!Number.isInteger(amount)||amount<1||amount>left){alert('Cantidad devuelta no válida.');return;}c.cantidadDevuelta+=amount;const net=Math.max(0,c.cantidad-c.cantidadDevuelta)*c.precioUnitario;c.estadoPago=c.montoPagado<=0?'Pendiente':c.montoPagado>=net?'Pagado':'Parcial';}
    if(del){if(!confirm('¿Eliminar la consignación? Las piezas dejarán de figurar como entregadas y volverán a estar disponibles.'))return;appState.consignments=appState.consignments.filter(x=>x.id!==c.id);}
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

export function renderManagementView(container, section='dashboard') {
  active=section;container.innerHTML=shell(section);
  attachBackup(container);
  if(section==='products'){renderProductsTable(container.querySelector('#products-table'));renderAssignments(container.querySelector('#product-assignments'));attachProducts(container);}
  if(section==='clients'){renderClientsTable(container.querySelector('#clients-table'));attachClients(container);}
  if(section==='sales'){renderSalesTable(container.querySelector('#sales-table'));attachSales(container);}
  if(section==='consignments'){renderConsignments(container.querySelector('#consignments-table'));attachConsignments(container);}
}
