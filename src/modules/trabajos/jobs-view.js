import { calculateJob } from '../../calculations/jobs.js';
import JsBarcode from 'jsbarcode';
import { appState, saveAppState } from '../../services/app-store.js';
import { uploadProductImage } from '../../services/product-images.js';
import { inventoryState, getMaterialById, applyJobMaterials, removeJobMaterial } from '../../services/inventory-store.js';

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
  const materiales = [...form.querySelectorAll('[data-filament-row]')].map(row => ({
    materialId: String(row.querySelector('[data-filament-material]')?.value || 'manual'),
    gramos: number(row.querySelector('[data-filament-grams]')?.value),
    color: String(row.querySelector('[data-filament-color]')?.value || '').trim(),
    extruder: row.dataset.extruder || '',
    source: row.dataset.source || 'manual',
  })).filter(row => row.gramos > 0);
  const gramosTotal = materiales.reduce((sum, row) => sum + row.gramos, 0);
  const costoMaterialTotal = materiales.reduce((sum, row) => {
    const material = getMaterialById(row.materialId);
    const pricePerKg = material ? material.costoPromedio * 1000 : number(fd.get('precioKg'));
    return sum + row.gramos * pricePerKg / 1000;
  }, 0);
  const precioKg = gramosTotal > 0 ? costoMaterialTotal * 1000 / gramosTotal : number(fd.get('precioKg'));
  const materialId = materiales.find(row => row.materialId !== 'manual')?.materialId || 'manual';
  const selectedNames = [...new Set(materiales.map(row => getMaterialById(row.materialId)?.nombre).filter(Boolean))];

  return {
    nombre: String(fd.get('nombre') || '').trim(),
    cliente: String(fd.get('cliente') || '').trim(),
    clientId: (() => { const name = String(fd.get('cliente') || '').trim().toLocaleLowerCase('es'); const matches = appState.clients.filter(client => String(client.nombre || '').trim().toLocaleLowerCase('es') === name); return matches.length === 1 ? matches[0].id : null; })(),
    fecha,
    descripcion: String(fd.get('descripcion') || '').trim(),
    estadoTrabajo: String(fd.get('estadoTrabajo') || 'cotizacion'),
    materialId,
    materialNombre: selectedNames.join(', '),
    materiales,
    gramos: gramosTotal,
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
    imagenReferencia: '',
    reservaFilamentoPct: 20,
    margen: number(fd.get('margen')),
  };
}

function parseSlicerGcode(content) {
  const findValues = pattern => {
    const match = content.match(pattern);
    return match ? match[1].split(/[;,|]/).map(value => value.trim()).filter(Boolean) : [];
  };
  const grams = findValues(/^\s*;\s*(?:filament used|filament weight|filament_usage)\s*\[?g\]?\s*[:=]\s*([^\r\n]+)/im)
    .map(value => Number.parseFloat(value.replace(',', '.'))).filter(value => Number.isFinite(value) && value > 0);
  const colors = findValues(/^\s*;\s*(?:filament_colour|filament_color|extruder_colour|extruder_color)\s*[:=]\s*([^\r\n]+)/im);
  const types = findValues(/^\s*;\s*filament_type\s*[:=]\s*([^\r\n]+)/im);
  return grams.map((value, index) => ({
    materialId: 'manual', gramos: value,
    color: [types[index], colors[index]].filter(Boolean).join(' · '),
    extruder: String(index + 1), source: 'Anycubic Slicer / G-code',
  }));
}

function renderPreview(data, calc) {
  const segments = [
    ['Filamento', calc.costoMaterial, '#ff783f'],
    ['Reserva para recompra de filamento (20%)', calc.reservaReposicionFilamento, '#f0a13a'],
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
  const labels=selectedJobs.flatMap(job=>{const quantity=Math.max(0,Number(job.data.piezas!==undefined?Number(job.data.piezas)-Number(job.data.piezasFallidas||0):job.data.piezasVendibles??1));return Array.from({length:quantity},(_,index)=>({job,piece:index+1,quantity,code:'PLJ'+String(job.id||'').replace(/[^a-z0-9]/gi,'').toUpperCase()+'P'+String(index+1).padStart(3,'0')}));});
  if(!labels.length){window.alert('No hay piezas vendibles para generar etiquetas de producción.');return;}
  const ns='http://www.w3.org/2000/svg',columns=3,labelWidth=70,labelHeight=40,rows=Math.ceil(labels.length/columns),svg=document.createElementNS(ns,'svg');
  svg.setAttribute('xmlns',ns);svg.setAttribute('width',(columns*labelWidth)+'mm');svg.setAttribute('height',(rows*labelHeight)+'mm');svg.setAttribute('viewBox',`0 0 ${columns*labelWidth} ${rows*labelHeight}`);svg.setAttribute('version','1.1');
  const addText=(group,x,y,value,size,weight='normal')=>{const node=document.createElementNS(ns,'text');node.setAttribute('x',x);node.setAttribute('y',y);node.setAttribute('text-anchor','middle');node.setAttribute('font-family','Arial,sans-serif');node.setAttribute('font-size',size);node.setAttribute('font-weight',weight);node.setAttribute('fill','#111');node.textContent=value;group.append(node);};
  labels.forEach((item,index)=>{
    const x=(index%columns)*labelWidth,y=Math.floor(index/columns)*labelHeight,group=document.createElementNS(ns,'g');group.setAttribute('transform',`translate(${x} ${y})`);
    const border=document.createElementNS(ns,'rect');border.setAttribute('x','1');border.setAttribute('y','1');border.setAttribute('width','68');border.setAttribute('height','38');border.setAttribute('rx','.8');border.setAttribute('fill','#fff');border.setAttribute('stroke','#999');border.setAttribute('stroke-width','.25');group.append(border);
    addText(group,35,7,String(item.job.data.nombre||'Producto').slice(0,48),3.4,'bold');
    const barcode=document.createElementNS(ns,'svg');JsBarcode(barcode,item.code,{format:'CODE128',displayValue:false,margin:5,height:70,width:1.5});
    const vb=barcode.getAttribute('viewBox');barcode.setAttribute('x','6');barcode.setAttribute('y','10');barcode.setAttribute('width','58');barcode.setAttribute('height','15');if(vb)barcode.setAttribute('viewBox',vb);barcode.setAttribute('preserveAspectRatio','xMidYMid meet');barcode.setAttribute('overflow','visible');group.append(barcode);
    addText(group,35,32,String(item.job.data.cliente||'Producción AM3D').slice(0,48),2.6);addText(group,35,36,`Pieza ${item.piece} de ${item.quantity} · ${item.code}`,2.5);svg.append(group);
  });
  const serialized=new XMLSerializer().serializeToString(svg),blob=new Blob(['<?xml version="1.0" encoding="UTF-8"?>'+serialized],{type:'image/svg+xml;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='etiquetas-produccion-AM3D.svg';document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),3000);
}

function renderHistory(filters = {}) {
  if (!jobs.length) {
    return '<div class="job-empty"><strong>Aún no hay trabajos</strong><span>Completa el formulario para registrar el primero.</span></div>';
  }
  const colorNames = {
    rojo:'#e53935', red:'#e53935', amarillo:'#fdd835', yellow:'#fdd835',
    negro:'#202124', black:'#202124', blanco:'#ffffff', white:'#ffffff',
    azul:'#2878d0', blue:'#2878d0', verde:'#269b62', green:'#269b62',
    naranja:'#f28c28', orange:'#f28c28', morado:'#8e55b8', purple:'#8e55b8',
    rosa:'#e879a8', pink:'#e879a8', gris:'#8b929e', gray:'#8b929e', grey:'#8b929e',
    plateado:'#b9c0ca', silver:'#b9c0ca', dorado:'#c9a227', gold:'#c9a227',
  };
  const statusLabels = { cotizacion:'Cotización', pendiente:'Pendiente', realizado:'Realizado' };
  const normalized = value => String(value ?? '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();
  const matches = (value, filter) => !filter || normalized(value).includes(normalized(filter));
  const filteredJobs = jobs.filter(job => {
    const data = job.data || {};
    const materials = Array.isArray(data.materiales) ? data.materiales : [];
    const filamentText = materials.map(item => [item.color, getMaterialById(item.materialId)?.nombre].filter(Boolean).join(' ')).join(' ');
    const date = new Date(data.fecha || job.createdAt || 0);
    const dateValue = Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0,10);
    return matches([data.nombre, data.cliente].join(' '), filters.trabajo)
      && matches(statusLabels[data.estadoTrabajo || 'realizado'] || data.estadoTrabajo, filters.estado)
      && matches(dateValue, filters.fecha)
      && matches(filamentText || data.materialNombre || '', filters.filamento)
      && matches(money(job.calc?.costoTotal), filters.costo)
      && matches(money(job.calc?.precioVenta), filters.precio)
      && matches(money(job.calc?.ganancia), filters.ganancia);
  });
  const filterInput = (key, placeholder, type = 'search') =>
    '<input class="job-history-filter" type="' + type + '" data-history-filter="' + key + '" value="' + escapeText(filters[key] || '') + '" placeholder="' + placeholder + '" aria-label="Filtrar por ' + placeholder + '">';
  return `
    <div class="job-table-scroll"><table class="job-table">
      <thead>
        <tr><th>Trabajo</th><th>Estado</th><th>Fecha</th><th>Filamento utilizado</th><th>Costo</th><th>Precio sugerido</th><th>Ganancia</th><th></th></tr>
        <tr class="job-history-filter-row">
          <th>${filterInput('trabajo','Trabajo o cliente')}</th>
          <th><select class="job-history-filter" data-history-filter="estado" aria-label="Filtrar por estado">
            <option value="">Todos</option>
            <option value="cotizacion" ${filters.estado === 'cotizacion' ? 'selected' : ''}>Cotización</option>
            <option value="pendiente" ${filters.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
            <option value="realizado" ${filters.estado === 'realizado' ? 'selected' : ''}>Realizado</option>
          </select></th>
          <th>${filterInput('fecha','Fecha','date')}</th>
          <th>${filterInput('filamento','Color o material')}</th>
          <th>${filterInput('costo','Costo')}</th>
          <th>${filterInput('precio','Precio')}</th>
          <th>${filterInput('ganancia','Ganancia')}</th>
          <th><button type="button" class="job-action" data-clear-history-filters>Limpiar</button></th>
        </tr>
      </thead>
      <tbody>${[...filteredJobs].sort((a,b) => Number(b.createdAt || b.updatedAt || b.data.fecha || 0) - Number(a.createdAt || a.updatedAt || a.data.fecha || 0)).map(job => {
        const materials = Array.isArray(job.data.materiales) && job.data.materiales.length
          ? job.data.materiales.filter(item => Number(item.gramos) > 0)
          : (Number(job.data.gramos) > 0 ? [{ gramos:job.data.gramos, color:job.data.materialNombre || '', materialId:job.data.materialId }] : []);
        const totalGrams = Number(job.data.gramos) || materials.reduce((sum,item) => sum + Number(item.gramos || 0),0);
        const uniqueColors = [];
        materials.forEach(item => {
          const linkedMaterial = getMaterialById(item.materialId);
          const label = String(linkedMaterial?.nombre || item.color || '').trim();
          const key = String(item.materialId || label).toLowerCase();
          if (label && !uniqueColors.some(color => color.key === key)) {
            const inventoryHex = /^#[0-9a-f]{6}$/i.test(String(linkedMaterial?.colorHex || '')) ? linkedMaterial.colorHex : '';
            const hex = inventoryHex || label.match(/#[0-9a-f]{3,8}\\b/i)?.[0];
            const namedColor = colorNames[label.toLowerCase()];
            uniqueColors.push({key,label,swatch:hex || namedColor || '#d5dbe5'});
          }
        });
        return `
        <tr>
          <td><strong>${escapeText(job.data.nombre)}</strong><small>${escapeText(job.data.codigoCatalogo || 'Código pendiente')} · ${escapeText(job.data.cliente || 'Sin cliente')}</small></td>
          <td><span class="job-status job-status-${escapeText(job.data.estadoTrabajo || 'realizado')}">${statusLabels[job.data.estadoTrabajo || 'realizado'] || job.data.estadoTrabajo}</span></td>
          <td>${new Date(job.data.fecha).toLocaleDateString('es-BO')}</td>
          <td><div class="job-filament-summary"><strong>${totalGrams > 0 ? totalGrams.toLocaleString('es-BO',{maximumFractionDigits:1}) + ' g' : '—'}</strong>
            <div class="job-filament-colors" aria-label="Colores de filamento">${uniqueColors.length ? uniqueColors.map(color => `<span class="job-filament-color" style="--filament-color:${color.swatch}" title="${escapeText(color.label)}" aria-label="${escapeText(color.label)}"></span>`).join('') : '<span class="job-filament-no-color">Sin color indicado</span>'}</div>
          </div></td>
          <td>${money(job.calc.costoTotal)}</td>
          <td class="job-highlight">${money(job.calc.precioVenta)}</td>
          <td>${money(job.calc.ganancia)}</td>
          <td><div class="job-actions">
            <button type="button" data-quote="${job.id}" class="job-action">Ver cotización</button>
            ${job.data.estadoTrabajo !== 'realizado' ? `<button type="button" data-mark-realized="${job.id}" class="job-action">Marcar realizado</button>` : `<button type="button" data-duplicate="${job.id}" class="job-action">Copiar a nueva cotización</button>`}
            <button type="button" data-edit="${job.id}" class="job-action">Editar</button>
            <button type="button" data-delete="${job.id}" class="job-action danger">Eliminar</button>
          </div></td>
        </tr>`;
      }).join('') || '<tr><td colspan="8" class="job-history-empty">No hay registros que coincidan con estos filtros.</td></tr>'}</tbody>
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
  const reference = `COT-${new Date(data.fecha || Date.now()).getFullYear()}-${String(job.id).slice(-8).toUpperCase()}`;
  const brandLogoUrl = new URL(import.meta.env.BASE_URL + 'imagotipo.svg', window.location.href).href;
  const materialRows = (Array.isArray(data.materiales) ? data.materiales : []).map(row => {
    const material = getMaterialById(row.materialId);
    const materialName = material?.nombre || 'Material manual';
    const materialType = materialName.match(/\\b(PLA\\+?|PETG\\+?|TPU|ABS|ASA|PVA|HIPS|PC|NYLON|PA|PET)\\b/i)?.[0]?.toUpperCase() || materialName;
    const colorName = material ? (material.colorHex || row.color || 'Color no definido') : (row.color || 'Color no especificado');
    return { materialType, colorName, grams: Number(row.gramos || 0) };
  }).filter(row => row.grams > 0);
  const materialsReport = materialRows.length ? `<section class="materials-report"><h2>Materiales y colores de fabricación</h2><table><thead><tr><th>Material</th><th>Color a utilizar</th><th>Cantidad estimada</th></tr></thead><tbody>${materialRows.map(row => `<tr><td>${escapeText(row.materialType)}</td><td>${escapeText(row.colorName)}</td><td>${row.grams.toLocaleString('es-BO',{maximumFractionDigits:2})} g</td></tr>`).join('')}</tbody></table></section>` : '';
  popup.document.open();
  popup.document.write(`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cotización ${escapeText(data.nombre)}</title>
<style>
  *{box-sizing:border-box}body{margin:0;padding:42px;color:#1D1D1B;background:#fff;font:14px Arial,sans-serif}
  .sheet{max-width:760px;margin:0 auto}.top{display:flex;justify-content:space-between;gap:24px;padding-bottom:22px;border-bottom:3px solid #E30613}
  .brand-logo{display:block;width:62mm;max-height:26mm;object-fit:contain}.muted{color:#5c5c5c}
  h1{margin:28px 0 6px;font-size:28px}.meta{display:flex;justify-content:space-between;gap:20px;margin:22px 0}
  .box{padding:15px 17px;border:1px solid #e8e5dd;border-radius:8px;min-width:0;flex:1}.box small{display:block;margin-bottom:7px;color:#5c5c5c;text-transform:uppercase;font-size:10px;letter-spacing:.7px}
  .box strong{font-size:14px}.description{margin:24px 0;color:#46536a;line-height:1.6;white-space:pre-wrap}
  table{width:100%;border-collapse:collapse;margin-top:26px}th{padding:12px;text-align:left;background:#fffbea;color:#5c5c5c;font-size:11px;text-transform:uppercase}
  td{padding:15px 12px;border-bottom:1px solid #e8e5dd;vertical-align:top}th:last-child,td:last-child{text-align:right;white-space:nowrap}
  .item-title{font-weight:700}.reference-image{margin:22px 0}.reference-image h2,.materials-report h2{font-size:15px;margin:0 0 10px}.reference-image img{display:block;max-width:100%;max-height:360px;object-fit:contain;border:1px solid #e8e5dd;border-radius:8px}.materials-report{margin-top:24px;break-inside:avoid}.materials-report table{margin-top:8px}.materials-report th:last-child,.materials-report td:last-child{text-align:left;white-space:normal}.total{display:flex;justify-content:flex-end;margin-top:18px}.total div{width:260px;padding:17px;background:#fffbea;border:1px solid #ffed00;border-radius:8px}
  .total span{display:block;color:#5c5c5c;font-size:11px}.total strong{display:block;margin-top:6px;color:#E30613;font-size:25px}
  .thanks{margin-top:48px;padding-top:17px;border-top:1px solid #e8e5dd;text-align:center;color:#5c5c5c;font-size:12px}
  .toolbar{max-width:760px;margin:0 auto 22px;display:flex;justify-content:flex-end;gap:8px}
  .toolbar button{padding:10px 16px;border:0;border-radius:6px;background:#E30613;color:#fff;font-weight:700;cursor:pointer}
  .toolbar button:last-child{background:#edf1f7;color:#46536a}
  @media print{body{padding:0}.toolbar{display:none}.sheet{max-width:none}.box,.total div{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  @page{size:A4;margin:18mm}
</style>
</head>
<body>
<div class="toolbar"><button onclick="window.print()">Imprimir / Guardar PDF</button><button onclick="window.close()">Cerrar</button></div>
<main class="sheet">
  <header class="top"><div><img class="brand-logo" src="${brandLogoUrl}" alt="Agencia de Modelos 3D"><div class="muted">Impresión 3D · Cotización</div></div><div style="text-align:right"><strong>${reference}</strong><div class="muted" style="margin-top:7px">${date}</div></div></header>
  <h1>Cotización</h1><p class="muted">Propuesta económica para el trabajo solicitado.</p>
  <section class="meta"><div class="box"><small>Cliente</small><strong>${escapeText(data.cliente || 'Cliente')}</strong></div><div class="box"><small>Trabajo</small><strong>${escapeText(data.nombre)}</strong></div></section>
  ${data.descripcion ? `<p class="description">${escapeText(data.descripcion)}</p>` : ''}
  ${data.imagenReferencia ? `<section class="reference-image"><h2>Imagen de referencia</h2><img src="${escapeText(data.imagenReferencia)}" alt="Imagen de referencia del trabajo"></section>` : ''}
  ${materialsReport}
  <table><thead><tr><th>Detalle</th><th>Cantidad</th><th>Precio unitario</th><th>Total</th></tr></thead>
  <tbody><tr><td><div class="item-title">${escapeText(data.nombre)}</div>${data.descripcion ? `<div class="muted" style="margin-top:5px">${escapeText(data.descripcion)}</div>` : ''}</td><td>${quantity}</td><td>${money(unitPrice)}</td><td>${money(calc.precioVenta)}</td></tr></tbody></table>
  <div class="total"><div><span>TOTAL DE LA COTIZACIÓN</span><strong>${money(calc.precioVenta)}</strong></div></div>
  <footer class="thanks">Gracias por considerar a AGENCIA DE MODELOS 3D para su proyecto.</footer>
</main>
</body></html>`);
  popup.document.close();
}

export function renderJobsView(container) {
  container.innerHTML = `
    <section class="jobs-module">
      <div class="jobs-intro">
        <div><p class="eyebrow">PRODUCCIÓN</p><h2>Trabajos de impresión</h2><p>Registra pedidos y calcula el costo real estimado de cada lote.</p></div>
        <span class="jobs-local-tag">Sincronizado en Firestore</span>
      </div>
      <div class="jobs-stats" id="jobsStats"></div>
      <div class="jobs-layout">
        <form class="jobs-card" id="jobForm">
          <div class="jobs-card-heading"><div><p class="eyebrow">NUEVO REGISTRO</p><h3 id="jobFormTitle">Nuevo trabajo o cotización</h3></div><span class="jobs-step">01</span></div>
          <div class="jobs-form-grid">
            <label class="job-field job-span-2"><span>Nombre del trabajo *</span><input name="nombre" required placeholder="Ej. Soporte para celular x3"></label>
            <label class="job-field"><span>Cliente / solicitado por</span><input name="cliente" placeholder="Nombre del cliente"></label>
            <label class="job-field"><span>Fecha del trabajo</span><input name="fecha" type="date"></label>
            <label class="job-field job-span-2"><span>Descripción / notas</span><textarea name="descripcion" rows="2" placeholder="Color, acabado, referencias…"></textarea></label>
          <div class="job-field job-span-2 quote-reference-upload"><span>Imagen de referencia (opcional)</span><label class="quote-reference-drop" id="quoteReferenceDrop"><input type="file" id="quoteReferenceFile" accept="image/*" hidden><strong>Pega una imagen con Ctrl + V o haz clic para seleccionarla</strong><small>Se adjuntará al reporte PDF de cotización.</small></label><div class="quote-reference-preview" id="quoteReferencePreview" hidden></div></div>
          </div>
          <div class="jobs-subheading">Tipo de registro</div>
          <div class="jobs-form-grid">
            <label class="job-field job-span-2"><span>Estado del trabajo</span><select name="estadoTrabajo"><option value="cotizacion" selected>Cotización (no descuenta inventario)</option><option value="pendiente">Aceptado / pendiente de producción</option><option value="realizado">Realizado (descuenta filamento)</option></select></label>
          </div>
          <p class="job-help">Una cotización o pedido pendiente no modifica el stock. Solo al marcarlo como realizado se registra el consumo.</p>
          <div class="jobs-subheading">Filamentos y colores</div>
          <div class="jobs-form-grid">
            <label class="job-field job-span-2"><span>Precio manual de referencia (Bs/kg)</span><input name="precioKg" type="number" min="0" step="any" placeholder="95"></label>
            <div class="job-span-2 filament-toolbar">
              <button type="button" class="job-action" id="addFilamentRow">+ Agregar filamento</button>
              <label class="job-action filament-import">Importar consumo del slicer (.gcode)<input type="file" id="slicerGcodeFile" accept=".gcode,.gco,.gc,.txt" hidden></label>
            </div>
            <div class="job-span-2" id="jobFilaments"></div>
            <p class="job-help job-span-2" id="jobMaterialHelp">Agrega una fila por cada color/material. Puedes importar los gramos estimados desde un archivo G-code si Anycubic Slicer los incluye.</p>
          </div>
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
            <button class="job-save" type="submit" id="jobSaveButton">Guardar registro</button>
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
  let quoteReferenceFile = null;
  let quoteReferenceUrl = '';
  const preview = container.querySelector('#jobPreview');
  const history = container.querySelector('#jobHistory');
  const stats = container.querySelector('#jobsStats');
  const materialPrice = form.elements.precioKg;
  const filamentRoot = container.querySelector('#jobFilaments');
  const materialHelp = container.querySelector('#jobMaterialHelp');
  const historyFilters = { trabajo:'', estado:'', fecha:'', filamento:'', costo:'', precio:'', ganancia:'' };

  function filamentRowMarkup(row = {}) {
    const options = ['<option value="manual">Costo manual / sin descuento</option>', ...inventoryState.materials
      .filter(item => item.categoria === 'Filamento' && item.unidad === 'g')
      .map(item => `<option value="${escapeText(item.id)}">${escapeText(item.nombre)} · ${Number(item.stock).toLocaleString('es-BO')} g · Bs ${(item.costoPromedio * 1000).toFixed(2)}/kg</option>`)];
    const material = inventoryState.materials.find(item => item.id === row.materialId);
    const color = /^#[0-9a-f]{6}$/i.test(String(material?.colorHex || '')) ? material.colorHex : '';
    return `<div class="filament-row" data-filament-row data-extruder="${escapeText(row.extruder || '')}" data-source="${escapeText(row.source || 'manual')}">
      <label class="job-field"><span>Material / bobina</span><select data-filament-material>${options.join('')}</select></label>
      <div class="job-field filament-color-display"><span>Color del inventario</span><div class="filament-color-value"><i data-filament-swatch style="--filament-color:${color || '#d5dbe5'}"></i><b data-filament-color-label>${escapeText(material?.nombre ? (color || 'Color no definido') : (row.color || 'Selecciona una bobina'))}</b></div><input data-filament-color type="hidden" value="${escapeText(row.color || '')}"></div>
      <label class="job-field"><span>Consumo (g)</span><input data-filament-grams type="number" min="0" step="0.01" value="${Number(row.gramos || 0) || ''}" placeholder="35"></label>
      <button type="button" class="job-action danger" data-remove-filament title="Quitar filamento">Quitar</button>
      <small>${row.extruder ? `Extrusor ${escapeText(row.extruder)} · Importado del slicer` : 'Consumo previsto / confirmado'}</small>
    </div>`;
  }

  function syncFilamentColor(row) {
    const materialId = row.querySelector('[data-filament-material]')?.value || 'manual';
    const material = materialId !== 'manual' ? getMaterialById(materialId) : null;
    const hex = /^#[0-9a-f]{6}$/i.test(String(material?.colorHex || '')) ? material.colorHex : '';
    const swatch = row.querySelector('[data-filament-swatch]');
    const label = row.querySelector('[data-filament-color-label]');
    const storedColor = row.querySelector('[data-filament-color]');
    if (swatch) swatch.style.setProperty('--filament-color', hex || '#d5dbe5');
    if (label) label.textContent = material ? (hex || 'Color no definido') : (storedColor?.value || 'Sin color asignado');
    if (storedColor && material) storedColor.value = hex || material.nombre;
  }

  function setFilamentRows(rows = [{}]) {
    filamentRoot.innerHTML = rows.map(filamentRowMarkup).join('');
    [...filamentRoot.querySelectorAll('[data-filament-row]')].forEach((row, index) => {
      row.querySelector('[data-filament-material]').value = rows[index]?.materialId || 'manual';
    });
  }

  function refreshMaterialOptions() {
    let rows = [...filamentRoot.querySelectorAll('[data-filament-row]')];
    if (!rows.length) { setFilamentRows([{}]); rows = [...filamentRoot.querySelectorAll('[data-filament-row]')]; }
    rows.forEach(row => {
      const select = row.querySelector('[data-filament-material]');
      const selected = select.value || 'manual';
      const options = ['<option value="manual">Costo manual / sin descuento</option>', ...inventoryState.materials
        .filter(item => item.categoria === 'Filamento' && item.unidad === 'g')
        .map(item => `<option value="${escapeText(item.id)}">${escapeText(item.nombre)} · ${Number(item.stock).toLocaleString('es-BO')} g · Bs ${(item.costoPromedio * 1000).toFixed(2)}/kg</option>`)];
      select.innerHTML = options.join('');
      select.value = inventoryState.materials.some(item => item.id === selected && item.categoria === 'Filamento' && item.unidad === 'g') ? selected : 'manual';
      syncFilamentColor(row);
    });
    const linked = rows.filter(row => row.querySelector('[data-filament-material]').value !== 'manual').length;
    materialPrice.readOnly = linked > 0 && linked === rows.length;
    materialHelp.textContent = linked
      ? 'Cada filamento seleccionado usa su costo promedio. Al confirmar el trabajo como realizado se descontará cada consumo del stock correspondiente.'
      : 'Los filamentos en costo manual no descuentan inventario. Vincula cada color a una bobina para controlar sus existencias.';
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
    history.innerHTML = renderHistory(historyFilters);
    const visibleCount = [...history.querySelectorAll('tbody tr')].filter(row => !row.querySelector('.job-history-empty')).length;
    container.querySelector('#jobsCount').textContent = visibleCount === count ? `${count} ${count === 1 ? 'registro' : 'registros'}` : `${visibleCount} de ${count} registros`;
  }

  window.addEventListener('appstate:loaded', refresh);

  function reset() {
    editingId = null;
    form.reset();
    form.elements.fecha.value = dateInput(Date.now());
    const settings = appState.settings || {};
    form.elements.precioKwh.value = String(settings.precioKwh ?? 0.70);
    form.elements.tipoImpresora.value = 'Anycubic Kobra X (FDM multicolor)';
    setFilamentRows([{}]);
    form.elements.watts.value = String(settings.potenciaW ?? 1450);
    form.elements.mantenimiento.value = String(settings.mantenimientoHora ?? 1.50);
    form.elements.horasTrabajo.value = String(settings.horasTrabajo ?? 0.5);
    form.elements.tarifaHora.value = String(settings.tarifaHora ?? 20);
    form.elements.fallas.value = String(settings.fallas ?? 10);
    form.elements.margen.value = String(settings.margen ?? 40);
    form.elements.precioKg.value = String(settings.precioFilamentoKg ?? 95);
    quoteReferenceFile = null; quoteReferenceUrl = '';
    const referencePreview = container.querySelector('#quoteReferencePreview');
    referencePreview.hidden = true; referencePreview.innerHTML = '';
    container.querySelector('#quoteReferenceFile').value = '';
    container.querySelector('#jobFormTitle').textContent = 'Nuevo trabajo o cotización';
    container.querySelector('#jobSaveButton').textContent = 'Guardar registro';
    refresh();
  }

  const referenceInput = container.querySelector('#quoteReferenceFile');
  const referenceDrop = container.querySelector('#quoteReferenceDrop');
  const referencePreview = container.querySelector('#quoteReferencePreview');
  function showReference(file, existingUrl = '') {
    if (file && !file.type.startsWith('image/')) { window.alert('Selecciona una imagen válida.'); return; }
    quoteReferenceFile = file || null;
    quoteReferenceUrl = existingUrl;
    const url = file ? URL.createObjectURL(file) : existingUrl;
    referencePreview.hidden = !url;
    referencePreview.innerHTML = url ? `<img src="${url}" alt="Vista previa de referencia"><button type="button" class="job-action danger" id="removeQuoteReference">Quitar imagen</button>` : '';
    referencePreview.querySelector('#removeQuoteReference')?.addEventListener('click', () => { quoteReferenceFile = null; quoteReferenceUrl = ''; referenceInput.value = ''; referencePreview.hidden = true; referencePreview.innerHTML = ''; });
  }
  referenceInput.addEventListener('change', () => { const file = referenceInput.files?.[0]; if (file) showReference(file); });
  referenceDrop.addEventListener('click', event => { if (event.target.closest('input')) return; referenceInput.click(); });
  form.addEventListener('paste', event => { const imageItem = [...(event.clipboardData?.items || [])].find(item => item.type.startsWith('image/')); if (!imageItem) return; const file = imageItem.getAsFile(); if (file) { event.preventDefault(); showReference(file); } });
  form.addEventListener('input', refresh);
  filamentRoot.addEventListener('change', event => {
    if (event.target.matches('[data-filament-material]')) syncFilamentColor(event.target.closest('[data-filament-row]'));
    refresh();
  });
  filamentRoot.addEventListener('click', event => {
    if (event.target.closest('[data-remove-filament]')) { event.target.closest('[data-filament-row]')?.remove(); refresh(); }
  });
  container.querySelector('#addFilamentRow').addEventListener('click', () => {
    const rows = [...filamentRoot.querySelectorAll('[data-filament-row]')].map(row => ({ materialId: row.querySelector('[data-filament-material]').value, gramos: row.querySelector('[data-filament-grams]').value, color: row.querySelector('[data-filament-color]').value }));
    rows.push({}); setFilamentRows(rows); refresh();
  });
  container.querySelector('#slicerGcodeFile').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try {
      const parsed = parseSlicerGcode(await file.text());
      if (!parsed.length) throw new Error('No encontré gramos por filamento en los metadatos del G-code. Exporta el G-code desde la vista previa de Anycubic Slicer después de laminar.');
      const existing = [...filamentRoot.querySelectorAll('[data-filament-row]')].map(row => ({ materialId: row.querySelector('[data-filament-material]').value, gramos: row.querySelector('[data-filament-grams]').value, color: row.querySelector('[data-filament-color]').value })).filter(row => Number(row.gramos) > 0);
      setFilamentRows([...existing, ...parsed]); refresh();
      window.alert(`Se importaron ${parsed.length} extrusor(es) con consumo estimado. Asigna cada uno a su bobina del inventario antes de guardar.`);
    } catch (error) { window.alert(error.message); }
    event.target.value = '';
  });
  window.addEventListener('inventory:updated', refresh);
  form.elements.tipoImpresora.addEventListener('change', () => {
    const selected = printerOptions.find(option => option[0] === form.elements.tipoImpresora.value);
    if (selected?.[2]) form.elements.watts.value = selected[2];
    refresh();
  });

  form.addEventListener('submit', async event => {
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
    const previousJob = editingId ? jobs.find(job => job.id === editingId) : null;
    // No alterar cotizaciones antiguas al editarlas: la reserva aplica a los trabajos nuevos.
    if (previousJob) data.reservaFilamentoPct = Number(previousJob.data.reservaFilamentoPct) || 0;
    data.imagenReferencia = quoteReferenceFile ? await uploadProductImage(quoteReferenceFile, 'cotizacion-' + jobId) : (quoteReferenceUrl || previousJob?.data?.imagenReferencia || '');
    data.codigoCatalogo = previousJob?.data?.codigoCatalogo || ('TR-' + String(jobId).replace(/[^a-z0-9]/gi, '').slice(-8).toUpperCase());
    try {
      if (data.estadoTrabajo === 'realizado') {
        applyJobMaterials(jobId, data);
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

  history.addEventListener('input', event => {
    const field = event.target.closest('[data-history-filter]');
    if (!field) return;
    historyFilters[field.dataset.historyFilter] = field.value;
    const key = field.dataset.historyFilter;
    const selectionStart = field.type === 'search' ? field.selectionStart : null;
    history.innerHTML = renderHistory(historyFilters);
    const replacementField = history.querySelector('[data-history-filter="' + key + '"]');
    replacementField?.focus();
    if (replacementField && typeof selectionStart === 'number') replacementField.setSelectionRange(selectionStart, selectionStart);
    const visibleCount = [...history.querySelectorAll('tbody tr')].filter(row => !row.querySelector('.job-history-empty')).length;
    container.querySelector('#jobsCount').textContent = `${visibleCount} de ${jobs.length} registros`;
  });
  history.addEventListener('change', event => {
    const field = event.target.closest('[data-history-filter]');
    if (!field) return;
    historyFilters[field.dataset.historyFilter] = field.value;
    history.innerHTML = renderHistory(historyFilters);
    const visibleCount = [...history.querySelectorAll('tbody tr')].filter(row => !row.querySelector('.job-history-empty')).length;
    container.querySelector('#jobsCount').textContent = `${visibleCount} de ${jobs.length} registros`;
  });
  history.addEventListener('click', event => {
    if (event.target.closest('[data-clear-history-filters]')) {
      Object.keys(historyFilters).forEach(key => historyFilters[key] = '');
      refresh();
      return;
    }
    const quoteButton = event.target.closest('[data-quote]');
    const productionLabel = event.target.closest('[data-production-label]');
    const printAllLabels = event.target.closest('[data-print-production-all]');
    const editButton = event.target.closest('[data-edit]');
    const duplicateButton = event.target.closest('[data-duplicate]');
    const markRealized = event.target.closest('[data-mark-realized]');
    const deleteButton = event.target.closest('[data-delete]');
    if (productionLabel) {
      const job = jobs.find(item => item.id === productionLabel.dataset.productionLabel);
      if (job) printProductionLabels([job]);
    }
    if (printAllLabels) printProductionLabels(jobs.filter(job => (job.data.estadoTrabajo || 'realizado') === 'realizado'));
    if (quoteButton) {
      const job = jobs.find(item => item.id === quoteButton.dataset.quote);
      if (job) openQuote(job);
    }
    if (markRealized) {
      const job = jobs.find(item => item.id === markRealized.dataset.markRealized);
      if (!job || job.data.estadoTrabajo === 'realizado') return;
      if (!window.confirm(`¿Confirmas que el trabajo "${job.data.nombre}" fue realizado? Se descontará el filamento registrado del inventario.`)) return;
      try {
        applyJobMaterials(job.id, job.data);
        job.data.estadoTrabajo = 'realizado';
        job.updatedAt = Date.now();
        saveAppState();
        window.dispatchEvent(new Event('inventory:updated'));
        refresh();
      } catch (error) { window.alert(error.message); }
    }
    if (duplicateButton) {
      const source = jobs.find(item => item.id === duplicateButton.dataset.duplicate);
      if (!source || (source.data.estadoTrabajo || 'realizado') !== 'realizado') return;
      // La copia es una cotización independiente: nunca reutiliza el ID ni modifica el trabajo original.
      editingId = null;
      form.reset();
      showReference(null, source.data.imagenReferencia || '');
      Object.entries(source.data || {}).forEach(([key, value]) => {
        if (key === 'materiales' || key === 'clientId' || !form.elements[key]) return;
        form.elements[key].value = key === 'fecha' ? dateInput(Date.now()) : value ?? '';
      });
      form.elements.nombre.value = String(source.data.nombre || '') + ' (copia)';
      form.elements.estadoTrabajo.value = 'cotizacion';
      const sourceMaterials = Array.isArray(source.data.materiales) && source.data.materiales.length
        ? source.data.materiales.map(item => ({ ...item }))
        : [{ materialId: source.data.materialId || 'manual', gramos: source.data.gramos || 0, color: source.data.materialNombre || '' }];
      setFilamentRows(sourceMaterials);
      container.querySelector('#jobFormTitle').textContent = 'Nueva cotización basada en trabajo realizado';
      container.querySelector('#jobSaveButton').textContent = 'Guardar nueva cotización';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      form.elements.nombre.focus();
      refresh();
      return;
    }
    if (editButton) {
      const job = jobs.find(item => item.id === editButton.dataset.edit);
      if (!job) return;
      editingId = job.id;
      showReference(null, job.data.imagenReferencia || '');
      Object.entries(job.data).forEach(([key, value]) => {
        if (form.elements[key]) {
          if (key === 'materiales') return;
          form.elements[key].value = key === 'fecha' ? dateInput(value) : value;
        }
      });
      setFilamentRows(Array.isArray(job.data.materiales) && job.data.materiales.length ? job.data.materiales : [{ materialId: job.data.materialId || 'manual', gramos: job.data.gramos, color: '' }]);
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
