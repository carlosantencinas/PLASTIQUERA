import { calculateJob } from '../../calculations/jobs.js';
import JsBarcode from 'jsbarcode';
import { appState, saveAppState } from '../../services/app-store.js';
import { inventoryState, getMaterialById, applyJobMaterial, removeJobMaterial } from '../../services/inventory-store.js';

const money = value =>
  'Bs ' + Number(value || 0).toLocaleString('es-BO', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const number = value => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const fields = [
  ['nombre', 'Nombre del trabajo', 'text', 'Soporte para celular x3'],
  ['cliente', 'Cliente / solicitado por', 'text', 'Nombre del cliente'],
  ['fecha', 'Fecha del trabajo', 'date', ''],
  ['descripcion', 'Descripción / notas', 'textarea', 'Color, acabado, referencias…'],
];

const printerOptions = [
  ['Anycubic Kobra X (FDM multicolor)', 'Anycubic Kobra X (FDM multicolor)', '1450'],
  ['', 'Seleccionar tipo', ''],
  ['Creality Ender 3 / Ender 3 V2 (FDM)', 'Creality Ender 3 / Ender 3 V2 (FDM)', '220'],
  ['Creality Ender 3 S1 / Neo (FDM)', 'Creality Ender 3 S1 / Neo (FDM)', '350'],
  ['Creality CR-10 (FDM)', 'Creality CR-10 (FDM)', '270'],
  ['Creality K1 (FDM)', 'Creality K1 (FDM)', '350'],
  ['Anycubic Kobra 2 (FDM)', 'Anycubic Kobra 2 (FDM)', '300'],
  ['Prusa i3 MK3S+ (FDM)', 'Prusa i3 MK3S+ (FDM)', '240'],
  ['Bambu Lab P1P / P1S (FDM)', 'Bambu Lab P1P / P1S (FDM)', '350'],
  ['Anycubic Photon (Resina)', 'Anycubic Photon (Resina)', '60'],
  ['Elegoo Mars (Resina)', 'Elegoo Mars (Resina)', '55'],
  ['Otro / Ingresar manualmente', 'Otro / Ingresar manualmente', ''],
];

let jobs = appState.jobs;
let editingId = null;

function input(name, label, type = 'number', placeholder = '', extra = '') {
  return `<label class="job-field"><span>${label}</span><input name="${name}" type="${type}" ${type === 'number' ? 'min="0" step="any"' : ''} placeholder="${placeholder}" ${extra}></label>`;
}

function readForm(form) {
  const fd = new FormData(form);
  const horasImp = number(fd.get('horasImp'));
  const minImp = number(fd.get('minImp'));
  const piezas = Math.max(1, Math.round(number(fd.get('piezas')) || 1));
  const piezasFallidas = Math.max(0, Math.round(number(fd.get('piezasFallidas'))));
  const fecha = fd.get('fecha')
    ? new Date(`${fd.get('fecha')}T12:00:00`).getTime()
    : Date.now();
  const materialId = String(fd.get('materialId') || 'manual');
  const selectedMaterial = materialId === 'manual' ? null : getMaterialById(materialId);
  const precioKg = selectedMaterial ? selectedMaterial.costoPromedio * 1000 : number(fd.get('precioKg'));

  return {
    nombre: String(fd.get('nombre') || '').trim(),
    cliente: String(fd.get('cliente') || '').trim(),
    fecha,
    descripcion: String(fd.get('descripcion') || '').trim(),
    estadoTrabajo: String(fd.get('estadoTrabajo') || 'cotizacion'),
    materialId,
    materialNombre: selectedMaterial?.nombre || '',
    gramos: number(fd.get('gramos')),
    precioKg,
    horasImp,
    minImp,
    horasImpresion: horasImp + minImp / 60,
    tipoImpresora: String(fd.get('tipoImpresora') || ''),
    watts: number(fd.get('watts')),
    precioKwh: number(fd.get('precioKwh')),
    mantenimiento: number(fd.get('mantenimiento')),
    horasTrabajo: number(fd.get('horasTrabajo')),
    tarifaHora: number(fd.get('tarifaHora')),
    otros: number(fd.get('otros')),
    fallas: number(fd.get('fallas')),
    piezas,
    piezasFallidas,
    piezasVendibles: Math.max(piezas - piezasFallidas, 0),
    margen: number(fd.get('margen')),
  };
}

function renderPreview(data, calc) {
  const segments = [
    ['Material', calc.costoMaterial, '#ff783f'],
    ['Energía', calc.costoEnergia, '#e8b83f'],
    ['Mantenimiento', calc.costoMantenimiento, '#8b93a0'],
    ['Mano de obra', calc.costoManoObra, '#c9a9e0'],
    ['Otros costos', calc.costoOtros, '#6fa8dc'],
    ['Colchón por fallas', calc.costoFallas, '#e8595a'],
    ['Ganancia', calc.ganancia, '#4ecdc4'],
  ];
  const total = calc.precioVenta || 1;
  return `
    <div class="job-price-preview">
      <span>PRECIO DE VENTA SUGERIDO</span>
      <strong>${money(calc.precioVenta)}</strong>
      <small>Ganancia estimada: <b>${money(calc.ganancia)}</b></small>
    </div>
    <div class="job-bar" aria-label="Composición del precio">
      ${segments.map(([label, value, color]) => value > 0
        ? `<span title="${label}: ${money(value)}" style="width:${Math.max(0, value / total * 100)}%;background:${color}"></span>`
        : '').join('')}
    </div>
    <div class="job-breakdown">
      ${segments.map(([label, value, color]) => `
        <div><i style="background:${color}"></i><span>${label}</span><b>${money(value)}</b></div>
      `).join('')}
      <div class="job-breakdown-total"><span>Costo total</span><b>${money(calc.costoTotal)}</b></div>
      ${data.piezas > 1 ? `<div class="job-breakdown-unit"><span>Precio por pieza vendible (${data.piezasVendibles})</span><b>${money(calc.precioUnitario)}</b></div>` : ''}
    </div>
    ${data.piezasFallidas > 0 ? `<p class="job-note">Piezas vendibles: ${data.piezasVendibles} de ${data.piezas}.</p>` : ''}
  `;
}

function printProductionLabels(selectedJobs) {
  const labels = selectedJobs.flatMap(job => {
    const quantity = Math.max(0, Number(job.data.piezasVendibles ?? job.data.piezas ?? 1));
    return Array.from({ length: quantity }, (_, index) => ({
      job,
      piece: index + 1,
      quantity,
      code: 'PLJ' + String(job.id || '').replace(/[^a-z0-9]/gi, '').toUpperCase() + 'P' + String(index + 1).padStart(3, '0'),
    }));
  });
  if (!labels.length) {
    window.alert('No hay piezas vendibles para generar etiquetas de producción.');
    return;
  }
  const popup = window.open('', '_blank', 'width=900,height=700');
  if (!popup) {
    window.alert('El navegador bloqueó la ventana de etiquetas. Permite las ventanas emergentes para este sitio.');
    return;
  }
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas de producción - Plastiquería</title>
    <style>
      @page { size:auto; margin:8mm; }
      * { box-sizing:border-box; }
      body { margin:0; padding:0; color:#111; font:10px Arial,sans-serif; }
      .labels { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:5mm; }
      .label { min-height:34mm; padding:3mm; border:1px dashed #aaa; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; break-inside:avoid; }
      .name { max-width:100%; margin-bottom:1mm; font-size:11px; font-weight:bold; overflow-wrap:anywhere; }
      .client,.piece,.code { margin-top:1mm; font-size:8px; color:#333; }
      svg { max-width:100%; height:auto; }
      @media screen { body { padding:12px; } .labels { max-width:800px; margin:auto; } }
    </style></head><body><div class="labels">${labels.map((item,index) => `
      <div class="label"><div class="name">${escapeText(item.job.data.nombre)}</div>
      <svg id="production-barcode-${index}"></svg>
      <div class="client">${escapeText(item.job.data.cliente || 'Producción Plastiquería')}</div>
      <div class="piece">Pieza ${item.piece} de ${item.quantity}</div>
      <div class="code">${escapeText(item.code)}</div></div>`).join('')}</div></body></html>`);
  popup.document.close();
  labels.forEach((item,index) => {
    const svg = popup.document.getElementById('production-barcode-' + index);
    try {
      JsBarcode(svg, item.code, { format:'CODE128', displayValue:true, fontSize:9, height:38, margin:2, width:1.35 });
    } catch (error) {
      console.error('No se pudo generar la etiqueta de producción:', error);
    }
  });
  popup.focus();
  popup.setTimeout(() => popup.print(), 250);
}

function renderHistory() {
  if (!jobs.length) {
    return '<div class="job-empty"><strong>Aún no hay trabajos</strong><span>Completa el formulario para registrar el primero.</span></div>';
  }
  return `
    <div class="job-table-scroll"><table class="job-table">
      <thead><tr><th>Trabajo</th><th>Estado</th><th>Fecha</th><th>Costo</th><th>Precio sugerido</th><th>Ganancia</th><th></th></tr></thead>
      <tbody>${[...jobs].sort((a,b) => b.data.fecha - a.data.fecha).map(job => `
        <tr>
          <td><strong>${escapeText(job.data.nombre)}</strong><small>${escapeText(job.data.cliente || 'Sin cliente')}</small></td>
          <td><span class="job-status job-status-${escapeText(job.data.estadoTrabajo || 'realizado')}">${({cotizacion:'Cotización',pendiente:'Pendiente',realizado:'Realizado'})[job.data.estadoTrabajo || 'realizado']}</span></td>
          <td>${new Date(job.data.fecha).toLocaleDateString('es-BO')}</td>
          <td>${money(job.calc.costoTotal)}</td>
          <td class="job-highlight">${money(job.calc.precioVenta)}</td>
          <td>${money(job.calc.ganancia)}</td>
          <td><div class="job-actions">
            <button type="button" data-quote="${job.id}" class="job-action">Ver cotización</button>
            ${job.data.estadoTrabajo !== 'realizado' ? `<button type="button" data-mark-realized="${job.id}" class="job-action">Marcar realizado</button>` : ''}
            <button type="button" data-edit="${job.id}" class="job-action">Editar</button>
            <button type="button" data-delete="${job.id}" class="job-action danger">Eliminar</button>
          </div></td>
        </tr>
      `).join('')}</tbody>
    </table></div>
  `;
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function dateInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function openQuote(job) {
  const { data, calc } = job;
  const popup = window.open('', '_blank', 'width=850,height=700');
  if (!popup) {
    window.alert('El navegador bloqueó la ventana de cotización. Permite las ventanas emergentes para este sitio e inténtalo nuevamente.');
    return;
  }
  const quantity = Math.max(0, Number(data.piezasVendibles ?? 1));
  const unitPrice = quantity > 1 ? calc.precioUnitario : calc.precioVenta;
  const date = new Date(data.fecha || Date.now()).toLocaleDateString('es-BO');
  const reference = `COT-${new Date(data.fecha || Date.now()).getFullYear()}-${String(job.id).slice(-6).toUpperCase()}`;
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cotización ${escapeText(data.nombre)}</title>
<style>
  *{box-sizing:border-box}body{margin:0;padding:42px;color:#20283a;background:#fff;font:14px Arial,sans-serif}
  .sheet{max-width:760px;margin:0 auto}.top{display:flex;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:3px solid #ff6b35}
  .brand{font-size:24px;font-weight:800;letter-spacing:-.7px}.brand span{color:#ff6b35}.muted{color:#68758c}
  h1{margin:28px 0 6px;font-size:28px}.meta{display:flex;justify-content:space-between;gap:20px;margin:22px 0}
  .box{padding:15px 17px;border:1px solid #e5eaf3;border-radius:8px;min-width:0;flex:1}.box small{display:block;margin-bottom:7px;color:#68758c;text-transform:uppercase;font-size:10px;letter-spacing:.7px}
  .box strong{font-size:14px}.description{margin:24px 0;color:#46536a;line-height:1.6;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;margin-top:26px}th{padding:12px;text-align:left;background:#f3f6fc;color:#68758c;font-size:11px;text-transform:uppercase}
  td{padding:15px 12px;border-bottom:1px solid #e5eaf3;vertical-align:top}th:last-child,td:last-child{text-align:right;white-space:nowrap}
  .item-title{font-weight:700}.total{display:flex;justify-content:flex-end;margin-top:18px}.total div{width:260px;padding:17px;background:#fff4ed;border-radius:8px}
  .total span{display:block;color:#68758c;font-size:11px}.total strong{display:block;margin-top:6px;color:#e95a27;font-size:25px}
  .thanks{margin-top:48px;padding-top:17px;border-top:1px solid #e5eaf3;text-align:center;color:#68758c;font-size:12px}
  .toolbar{max-width:760px;margin:0 auto 22px;display:flex;justify-content:flex-end;gap:8px}
  .toolbar button{padding:10px 16px;border:0;border-radius:6px;background:#ff6b35;color:#fff;font-weight:700;cursor:pointer}
  .toolbar button:last-child{background:#edf1f7;color:#46536a}
  @media print{body{padding:0}.toolbar{display:none}.sheet{max-width:none}.box,.total div{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  @page{size:A4;margin:18mm}
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Imprimir / Guardar PDF</button><button onclick="window.close()">Cerrar</button></div>
<main class="sheet">
  <header class="top"><div><div class="brand">PLASTI<span>QUERÍA</span></div><div class="muted">Impresión 3D · Cotización</div></div><div style="text-align:right"><strong>${reference}</strong><div class="muted" style="margin-top:7px">${date}</div></div></header>
  <h1>Cotización</h1><p class="muted">Propuesta económica para el trabajo solicitado.</p>
  <section class="meta"><div class="box"><small>Cliente</small><strong>${escapeText(data.cliente || 'Cliente')}</strong></div><div class="box"><small>Trabajo</small><strong>${escapeText(data.nombre)}</strong></div></section>
  ${data.descripcion ? `<p class="description">${escapeText(data.descripcion)}</p>` : ''}
  <table><thead><tr><th>Detalle</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead>
  <tbody><tr><td><div class="item-title">${escapeText(data.nombre)}</div>${data.descripcion ? `<div class="muted" style="margin-top:5px">${escapeText(data.descripcion)}</div>` : ''}</td><td>${quantity}</td><td>${money(unitPrice)}</td><td>${money(calc.precioVenta)}</td></tr></tbody></table>
  <div class="total"><div><span>TOTAL DE LA COTIZACIÓN</span><strong>${money(calc.precioVenta)}</strong></div></div>
  <footer class="thanks">Gracias por considerar a PLASTIQUERÍA para su proyecto.</footer>
</main>
</body></html>`);
  popup.document.close();
}

export function renderJobsView(container) {
  container.innerHTML = `
    <section class="jobs-module">
      <div class="jobs-intro">
        <div><p class="eyebrow">PRODUCCIÓN</p><h2>Trabajos de impresión</h2><p>Registra pedidos y calcula el costo real estimado de cada lote.</p></div>
        <span class="jobs-local-tag">Guardado local automático</span>
      </div>
      <div class="jobs-stats" id="jobsStats"></div>
      <div class="jobs-layout">
        <form class="jobs-card" id="jobForm">
          <div class="jobs-card-heading"><div><p class="eyebrow">NUEVO REGISTRO</p><h3 id="jobFormTitle">Nuevo trabajo</h3></div><span class="jobs-step">01</span></div>
          <div class="jobs-form-grid">
            <label class="job-field job-span-2"><span>Nombre del trabajo *</span><input name="nombre" required placeholder="Ej. Soporte para celular x3"></label>
            <label class="job-field"><span>Cliente / solicitado por</span><input name="cliente" placeholder="Nombre del cliente"></label>
            <label class="job-field"><span>Fecha del trabajo</span><input name="fecha" type="date"></label>
            <label class="job-field job-span-2"><span>Descripción / notas</span><textarea name="descripcion" rows="2" placeholder="Color, acabado, referencias…"></textarea></label>
          </div>
          <div class="jobs-subheading">Tipo de registro</div>
          <div class="jobs-form-grid">
            <label class="job-field job-span-2"><span>Estado del trabajo</span><select name="estadoTrabajo"><option value="cotizacion" selected>Cotización (no descuenta inventario)</option><option value="pendiente">Aceptado / pendiente de producción</option><option value="realizado">Realizado (descuenta filamento)</option></select></label>
          </div>
          <p class="job-help">Una cotización o pedido pendiente no modifica el stock. Solo al marcarlo como realizado se registra el consumo.</p>
          <div class="jobs-subheading">Material</div>
          <div class="jobs-form-grid">
            <label class="job-field job-span-2"><span>Material del inventario</span>
              <select name="materialId" id="jobMaterialSelect">
                <option value="manual">Costo manual (sin descontar inventario)</option>
                ${inventoryState.materials.filter(item => item.unidad === 'g').map(item => `<option value="${escapeText(item.id)}">${escapeText(item.nombre)} · ${Number(item.stock).toLocaleString('es-BO')} g disponibles · Bs ${(item.costoPromedio * 1000).toFixed(2)}/kg</option>`).join('')}
              </select>
            </label>
            ${input('gramos','Cantidad utilizada (g)','number','120')}
            ${input('precioKg','Precio del material (Bs/kg)','number','95')}
          </div>
          <p class="job-help" id="jobMaterialHelp">Selecciona un material para usar su costo promedio y descontar el consumo. Si eliges costo manual, el inventario no cambia.</p>
          <div class="jobs-subheading">Impresión</div>
          <div class="jobs-form-grid">
            ${input('horasImp','Horas de impresión','number','4')}
            ${input('minImp','Minutos de impresión','number','30','max="59"')}
            <label class="job-field job-span-2"><span>Tipo de impresora</span><select name="tipoImpresora">${printerOptions.map(([value,label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
            ${input('watts','Potencia de cálculo (W)','number','1450')}
            ${input('precioKwh','Energía (Bs/kWh)','number','0.7')}
            <p class="job-help job-span-2">Kobra X: potencia nominal máxima de referencia 1450 W a 220 V / 50 Hz. El consumo real varía según la temperatura de cama y boquilla, el material y la fase de impresión. Ajusta los W si dispones de una medición con vatímetro.</p>
            ${input('mantenimiento','Mantenimiento (Bs/hora)','number','1.5')}
          </div>
          <div class="jobs-subheading">Mano de obra y otros costos</div>
          <div class="jobs-form-grid">
            ${input('horasTrabajo','Horas de trabajo','number','0.5')}
            ${input('tarifaHora','Tarifa (Bs/hora)','number','20')}
            ${input('otros','Otros costos (Bs)','number','0')}
            ${input('fallas','Colchón por fallas (%)','number','10')}
          </div>
          <div class="jobs-subheading">Precio de venta</div>
          <div class="jobs-form-grid">
            ${input('piezas','Piezas impresas','number','1','min="1" step="1"')}
            ${input('piezasFallidas','Piezas no vendibles','number','0','step="1"')}
            ${input('margen','Ganancia sobre costo (%)','number','40')}
          </div>
          <div class="jobs-form-actions">
            <button class="job-save" type="submit" id="jobSaveButton">Guardar trabajo</button>
            <button class="job-reset" type="submit" data-action="quote">Guardar y cotizar</button>
            <button class="job-reset" type="button" id="jobResetButton">Limpiar</button>
          </div>
          <p class="job-help">Los trabajos y sus consumos se guardan automáticamente en la nube (Firestore).</p>
        </form>
        <section class="jobs-card jobs-preview-card">
          <div class="jobs-card-heading"><div><p class="eyebrow">ANÁLISIS DE COSTOS</p><h3>Vista previa</h3></div><span class="jobs-step">02</span></div>
          <div id="jobPreview"></div>
        </section>
      </div>
      <section class="jobs-card jobs-history-card">
        <div class="jobs-card-heading"><div><p class="eyebrow">HISTORIAL</p><h3>Trabajos registrados</h3></div><div class="jobs-history-actions"><button type="button" class="job-action" data-print-production-all>Etiquetas de toda la producción</button><span class="jobs-count" id="jobsCount">0 registros</span></div></div>
        <div id="jobHistory"></div>
      </section>
    </section>
  `;

  const form = container.querySelector('#jobForm');
  const preview = container.querySelector('#jobPreview');
  const history = container.querySelector('#jobHistory');
  const stats = container.querySelector('#jobsStats');
  const materialSelect = form.elements.materialId;
  const materialPrice = form.elements.precioKg;
  const materialHelp = container.querySelector('#jobMaterialHelp');

  function refreshMaterialOptions() {
    const selected = materialSelect.value || 'manual';
    const options = inventoryState.materials
      .filter(item => item.unidad === 'g')
      .map(item => {
        const disabled = item.stock <= 0 ? ' disabled' : '';
        return `<option value="${escapeText(item.id)}"${disabled}>${escapeText(item.nombre)} · ${Number(item.stock).toLocaleString('es-BO')} g disponibles · Bs ${(item.costoPromedio * 1000).toFixed(2)}/kg</option>`;
      }).join('');
    materialSelect.innerHTML = '<option value="manual">Costo manual (sin descontar inventario)</option>' + options;
    materialSelect.value = inventoryState.materials.some(item => item.id === selected && item.unidad === 'g') ? selected : 'manual';
    const material = getMaterialById(materialSelect.value);
    if (material) {
      materialPrice.value = (material.costoPromedio * 1000).toFixed(4);
      materialPrice.readOnly = true;
      materialHelp.textContent = `Costo promedio: Bs ${(material.costoPromedio * 1000).toFixed(2)}/kg. Al guardar se descontarán los gramos utilizados del stock.`;
    } else {
      materialPrice.readOnly = false;
      materialHelp.textContent = 'Costo manual: no se descontará material del inventario.';
    }
  }

  function values() {
    const data = readForm(form);
    return { data, calc: calculateJob(data) };
  }

  function refresh() {
    refreshMaterialOptions();
    const { data, calc } = values();
    preview.innerHTML = renderPreview(data, calc);
    const count = jobs.length;
    const revenue = jobs.filter(job => (job.data.estadoTrabajo || 'realizado') === 'realizado').reduce((sum, job) => sum + job.calc.precioVenta, 0);
    const profit = jobs.filter(job => (job.data.estadoTrabajo || 'realizado') === 'realizado').reduce((sum, job) => sum + job.calc.ganancia, 0);
    const quotes = jobs.filter(job => job.data.estadoTrabajo === 'cotizacion').length;
    const completed = jobs.filter(job => (job.data.estadoTrabajo || 'realizado') === 'realizado').length;
    stats.innerHTML = `
      <article><span>REGISTROS</span><strong>${count}</strong></article>
      <article><span>COTIZACIONES</span><strong>${quotes}</strong></article>
      <article><span>REALIZADOS</span><strong>${completed}</strong></article>
      <article><span>VENTAS REALIZADAS</span><strong>${money(revenue)}</strong></article>
      <article><span>GANANCIA PROYECTADA</span><strong>${money(profit)}</strong></article>
    `;
    history.innerHTML = renderHistory();
    container.querySelector('#jobsCount').textContent = `${count} ${count === 1 ? 'registro' : 'registros'}`;
  }

  window.addEventListener('appstate:loaded', refresh);

  function reset() {
    editingId = null;
    form.reset();
    form.elements.fecha.value = dateInput(Date.now());
    form.elements.precioKwh.value = '0.7';
    form.elements.tipoImpresora.value = 'Anycubic Kobra X (FDM multicolor)';
    form.elements.watts.value = '1450';
    container.querySelector('#jobFormTitle').textContent = 'Nuevo trabajo';
    container.querySelector('#jobSaveButton').textContent = 'Guardar trabajo';
    refresh();
  }

  form.addEventListener('input', refresh);
  materialSelect.addEventListener('change', refresh);
  window.addEventListener('inventory:updated', refresh);
  form.elements.tipoImpresora.addEventListener('change', () => {
    const selected = printerOptions.find(option => option[0] === form.elements.tipoImpresora.value);
    if (selected?.[2]) form.elements.watts.value = selected[2];
    refresh();
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const makeQuote = event.submitter?.dataset.action === 'quote';
    const { data } = values();
    if (makeQuote) data.estadoTrabajo = 'cotizacion';
    if (!data.nombre) return;
    if (editingId) {
      const sold = appState.sales.filter(sale => sale.jobId === editingId).reduce((sum, sale) => sum + Number(sale.cantidad || 1), 0);
      if (data.piezasVendibles < sold) {
        window.alert(`No puedes reducir las piezas vendibles a ${data.piezasVendibles}: ya existen ${sold} piezas vendidas para este trabajo.`);
        return;
      }
    }
    const jobId = editingId || (globalThis.crypto?.randomUUID?.() ?? `job_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    try {
      let movement = null;
      if (data.estadoTrabajo === 'realizado') {
        movement = applyJobMaterial(jobId, data);
        if (movement) {
          data.materialId = movement.materialId;
          data.materialNombre = movement.materialNombre;
          data.precioKg = movement.costoUnitario * 1000;
        }
      } else {
        removeJobMaterial(jobId);
      }
      const calc = calculateJob(data);
      if (editingId) {
        const index = jobs.findIndex(job => job.id === editingId);
        if (index !== -1) jobs[index] = { ...jobs[index], data, calc, updatedAt: Date.now() };
      } else {
        jobs.push({ id: jobId, createdAt: Date.now(), data, calc });
      }
      saveAppState();
      window.dispatchEvent(new Event('inventory:updated'));
      const savedJob = { id: jobId, data: { ...data }, calc };
      reset();
      if (makeQuote) openQuote(savedJob);
    } catch (error) {
      window.alert(error.message);
    }
  });

  container.querySelector('#jobResetButton').addEventListener('click', reset);

  history.addEventListener('click', event => {
    const quoteButton = event.target.closest('[data-quote]');
    const productionLabel = event.target.closest('[data-production-label]');
    const printAllLabels = event.target.closest('[data-print-production-all]');
    const editButton = event.target.closest('[data-edit]');
    const markRealized = event.target.closest('[data-mark-realized]');
    const deleteButton = event.target.closest('[data-delete]');
    if (productionLabel) {
      const job = jobs.find(item => item.id === productionLabel.dataset.productionLabel);
      if (job) printProductionLabels([job]);
    }
    if (printAllLabels) printProductionLabels(jobs);
    if (quoteButton) {
      const job = jobs.find(item => item.id === quoteButton.dataset.quote);
      if (job) openQuote(job);
    }
    if (markRealized) {
      const job = jobs.find(item => item.id === markRealized.dataset.markRealized);
      if (!job || job.data.estadoTrabajo === 'realizado') return;
      if (!window.confirm(`¿Confirmas que el trabajo "${job.data.nombre}" fue realizado? Se descontará el filamento registrado del inventario.`)) return;
      try {
        const movement = applyJobMaterial(job.id, job.data);
        if (movement) {
          job.data.materialId = movement.materialId;
          job.data.materialNombre = movement.materialNombre;
          job.data.precioKg = movement.costoUnitario * 1000;
        }
        job.data.estadoTrabajo = 'realizado';
        job.updatedAt = Date.now();
        saveAppState();
        window.dispatchEvent(new Event('inventory:updated'));
        refresh();
      } catch (error) { window.alert(error.message); }
    }
    if (editButton) {
      const job = jobs.find(item => item.id === editButton.dataset.edit);
      if (!job) return;
      editingId = job.id;
      Object.entries(job.data).forEach(([key, value]) => {
        if (form.elements[key]) {
          form.elements[key].value = key === 'fecha' ? dateInput(value) : value;
        }
      });
      container.querySelector('#jobFormTitle').textContent = 'Editar trabajo';
      container.querySelector('#jobSaveButton').textContent = 'Guardar cambios';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      refresh();
    }
    if (deleteButton) {
      const job = jobs.find(item => item.id === deleteButton.dataset.delete);
      if (!job) return;
      if (appState.sales.some(sale => sale.jobId === job.id)) {
        window.alert('No se puede eliminar este trabajo porque tiene ventas registradas. Elimina o reasigna primero esas ventas para conservar el historial.');
        return;
      }
      if (!window.confirm(`¿Eliminar el trabajo "${job.data.nombre}"? Esta acción no se puede deshacer.`)) return;
      removeJobMaterial(job.id);
      jobs.splice(jobs.findIndex(item => item.id === job.id), 1);
      saveAppState();
      window.dispatchEvent(new Event('inventory:updated'));
      if (editingId === job.id) reset();
      else refresh();
    }
  });

  reset();
}
