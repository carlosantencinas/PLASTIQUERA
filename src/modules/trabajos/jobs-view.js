import { calculateJob } from '../../calculations/jobs.js';
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

let jobs = [];
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

function renderHistory() {
  if (!jobs.length) {
    return '<div class="job-empty"><strong>Aún no hay trabajos</strong><span>Completa el formulario para registrar el primero.</span></div>';
  }
  return `
    <div class="job-table-scroll"><table class="job-table">
      <thead><tr><th>Trabajo</th><th>Fecha</th><th>Costo</th><th>Precio sugerido</th><th>Ganancia</th><th></th></tr></thead>
      <tbody>${[...jobs].sort((a,b) => b.data.fecha - a.data.fecha).map(job => `
        <tr>
          <td><strong>${escapeText(job.data.nombre)}</strong><small>${escapeText(job.data.cliente || 'Sin cliente')}</small></td>
          <td>${new Date(job.data.fecha).toLocaleDateString('es-BO')}</td>
          <td>${money(job.calc.costoTotal)}</td>
          <td class="job-highlight">${money(job.calc.precioVenta)}</td>
          <td>${money(job.calc.ganancia)}</td>
          <td><div class="job-actions">
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

export function renderJobsView(container) {
  container.innerHTML = `
    <section class="jobs-module">
      <div class="jobs-intro">
        <div><p class="eyebrow">PRODUCCIÓN</p><h2>Trabajos de impresión</h2><p>Registra pedidos y calcula el costo real estimado de cada lote.</p></div>
        <span class="jobs-local-tag">Módulo en desarrollo</span>
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
            ${input('watts','Potencia (W)','number','220')}
            ${input('precioKwh','Energía (Bs/kWh)','number','0.7')}
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
            <button class="job-reset" type="button" id="jobResetButton">Limpiar</button>
          </div>
          <p class="job-help">Los registros de esta etapa permanecen en memoria mientras la página está abierta. Aún no se guardan en Firebase.</p>
        </form>
        <section class="jobs-card jobs-preview-card">
          <div class="jobs-card-heading"><div><p class="eyebrow">ANÁLISIS DE COSTOS</p><h3>Vista previa</h3></div><span class="jobs-step">02</span></div>
          <div id="jobPreview"></div>
        </section>
      </div>
      <section class="jobs-card jobs-history-card">
        <div class="jobs-card-heading"><div><p class="eyebrow">HISTORIAL</p><h3>Trabajos registrados</h3></div><span class="jobs-count" id="jobsCount">0 registros</span></div>
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
    const revenue = jobs.reduce((sum, job) => sum + job.calc.precioVenta, 0);
    const profit = jobs.reduce((sum, job) => sum + job.calc.ganancia, 0);
    stats.innerHTML = `
      <article><span>TRABAJOS</span><strong>${count}</strong></article>
      <article><span>VENTAS PROYECTADAS</span><strong>${money(revenue)}</strong></article>
      <article><span>GANANCIA PROYECTADA</span><strong>${money(profit)}</strong></article>
    `;
    history.innerHTML = renderHistory();
    container.querySelector('#jobsCount').textContent = `${count} ${count === 1 ? 'registro' : 'registros'}`;
  }

  function reset() {
    editingId = null;
    form.reset();
    form.elements.fecha.value = dateInput(Date.now());
    form.elements.precioKwh.value = '0.7';
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
    const { data } = values();
    if (!data.nombre) return;
    const jobId = editingId || (globalThis.crypto?.randomUUID?.() ?? `job_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    try {
      const movement = applyJobMaterial(jobId, data);
      if (movement) {
        data.materialId = movement.materialId;
        data.materialNombre = movement.materialNombre;
        data.precioKg = movement.costoUnitario * 1000;
      }
      const calc = calculateJob(data);
      if (editingId) {
        const index = jobs.findIndex(job => job.id === editingId);
        if (index !== -1) jobs[index] = { ...jobs[index], data, calc, updatedAt: Date.now() };
      } else {
        jobs.push({ id: jobId, createdAt: Date.now(), data, calc });
      }
      window.dispatchEvent(new Event('inventory:updated'));
      reset();
    } catch (error) {
      window.alert(error.message);
    }
  });

  container.querySelector('#jobResetButton').addEventListener('click', reset);

  history.addEventListener('click', event => {
    const editButton = event.target.closest('[data-edit]');
    const deleteButton = event.target.closest('[data-delete]');
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
      if (!job || !window.confirm(`¿Eliminar el trabajo "${job.data.nombre}"? Esta acción no se puede deshacer.`)) return;
      removeJobMaterial(job.id);
      jobs = jobs.filter(item => item.id !== job.id);
      window.dispatchEvent(new Event('inventory:updated'));
      if (editingId === job.id) reset();
      else refresh();
    }
  });

  reset();
}
