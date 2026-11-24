import { collection, getDocs } from 'firebase/firestore';
import { db } from '../../services/firebase.js';
import { appState, saveAppState } from '../../services/app-store.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money = value => 'Bs ' + Number(value || 0).toLocaleString('es-BO',{minimumFractionDigits:2,maximumFractionDigits:2});
const fields = ['tipoRegistro','codigo','nombre','descripcion','imagenUrl','precioVenta','colores','otrosColoresPedido','productoNombre'];
let records = [];

function overrides() {
  if (!appState.settings || typeof appState.settings !== 'object') appState.settings = {};
  if (!appState.settings.catalogoPublicaciones || typeof appState.settings.catalogoPublicaciones !== 'object') appState.settings.catalogoPublicaciones = {};
  return appState.settings.catalogoPublicaciones;
}
function safeFields(source={}) {
  const result={};
  for(const key of fields) if(source[key]!==undefined) result[key]=source[key];
  result.colores=Array.isArray(result.colores)?result.colores.map(x=>String(x).trim()).filter(Boolean).slice(0,30):[];
  result.precioVenta=Math.max(0,Number(result.precioVenta||0));
  return result;
}
function setSourcePublished(id,visible) {
  const product=appState.products.find(item=>'producto_'+String(item.id).replace(/[^a-zA-Z0-9_-]/g,'_')===id);
  if(product) product.publicadoCatalogo=visible;
  const job=appState.jobs.find(item=>'trabajo_'+String(item.id).replace(/[^a-zA-Z0-9_-]/g,'_')===id);
  if(job?.data) {
    job.data.catalogoPublicado=visible;
    job.data.catalogoProductoId=job.data.catalogoProductoId||job.data.productoId||job.data.productId||job.data.producto?.id||'';
  }
}
function sourceName(id,record) {
  const product=appState.products.find(item=>'producto_'+String(item.id).replace(/[^a-zA-Z0-9_-]/g,'_')===id);
  const job=appState.jobs.find(item=>'trabajo_'+String(item.id).replace(/[^a-zA-Z0-9_-]/g,'_')===id);
  return product?.nombre||job?.data?.nombre||record.nombre||'Publicación';
}
async function loadRecords() {
  if(!db) throw new Error('Firebase no está configurado.');
  const snapshot=await getDocs(collection(db,'catalogo_publico'));
  const stored=overrides();
  const live=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));
  const liveIds=new Set(live.map(item=>item.id));
  const archived=Object.entries(stored).filter(([id,value])=>value?.visible===false&&!liveIds.has(id))
    .map(([id,value])=>({id,...safeFields(value.fields||{}),_archived:true}));
  records=[...live,...archived].map(record=>{
    const override=stored[record.id];
    return override?.fields?{...record,...safeFields(override.fields)}:record;
  }).sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''),'es'));
}
function renderList(root) {
  const term=root.querySelector('#catalog-admin-search').value.trim().toLocaleLowerCase('es');
  const status=root.querySelector('#catalog-admin-status').value;
  const filtered=records.filter(item=>{
    const archived=item._archived||overrides()[item.id]?.visible===false;
    if(status==='publicadas'&&archived)return false;
    if(status==='retiradas'&&!archived)return false;
    return [item.nombre,item.codigo,item.descripcion,item.id].join(' ').toLocaleLowerCase('es').includes(term);
  });
  root.querySelector('#catalog-admin-count').textContent=filtered.length+' publicaciones';
  root.querySelector('#catalog-admin-list').innerHTML=filtered.length?filtered.map(item=>{
    const archived=item._archived||overrides()[item.id]?.visible===false;
    const image=item.imagenUrl?'<img src="'+esc(item.imagenUrl)+'" alt="" loading="lazy">':'<div class="catalog-admin-no-image">AM3D</div>';
    return '<article class="catalog-admin-card"><div class="catalog-admin-thumb">'+image+'</div><div class="catalog-admin-info"><span class="catalog-admin-status '+(archived?'is-hidden':'is-live')+'">'+(archived?'RETIRADA':'PUBLICADA')+'</span><h3>'+esc(item.nombre||'Publicación')+'</h3><small>'+esc(item.codigo||item.id)+' · '+(item.tipoRegistro==='trabajo'?'Trabajo':'Producto')+'</small><strong>'+money(item.precioVenta)+'</strong><p>'+esc(item.descripcion||'Sin descripción')+'</p></div><div class="catalog-admin-actions"><button type="button" class="management-button secondary" data-catalog-edit="'+esc(item.id)+'">Editar</button><button type="button" class="management-button '+(archived?'':'danger')+'" data-catalog-toggle="'+esc(item.id)+'">'+(archived?'Volver a publicar':'Retirar')+'</button></div></article>';
  }).join(''):'<p class="management-empty">No hay publicaciones en esta vista.</p>';
}
function openEditor(root,record) {
  const dialog=document.createElement('dialog');
  dialog.className='management-form-dialog catalog-admin-dialog';
  const colors=Array.isArray(record.colores)?record.colores.join(', '):'';
  dialog.innerHTML='<form class="management-dialog-form"><div class="management-dialog-heading"><div><p class="eyebrow">GESTIÓN DEL CATÁLOGO</p><h3>Editar publicación</h3><p>Los cambios afectan la ficha pública, no el costo ni el historial del taller.</p></div><button type="button" class="management-dialog-close" data-close>×</button></div><label class="management-field">Nombre público<input name="nombre" maxlength="160" required></label><label class="management-field">Código visible<input name="codigo" maxlength="80"></label><label class="management-field">Descripción pública<textarea name="descripcion" rows="4" maxlength="1200"></textarea></label><div class="management-form-row"><label class="management-field">Precio público (Bs)<input name="precioVenta" type="number" min="0" step="0.01" required></label><label class="management-field">Imagen (URL https)<input name="imagenUrl" type="url" placeholder="https://..."></label></div><label class="management-field">Colores disponibles<input name="colores" placeholder="Negro, blanco, rojo"><small>Separa los colores con comas.</small></label><label class="catalog-publish-other-colors"><input name="otrosColoresPedido" type="checkbox"> Mostrar «Otros colores disponibles a pedido»</label><p class="management-dialog-error" hidden role="alert"></p><div class="management-dialog-actions"><button type="button" class="management-button secondary" data-close>Cancelar</button><button type="submit" class="management-button">Guardar cambios</button></div></form>';
  const form=dialog.querySelector('form');
  form.elements.nombre.value=record.nombre||'';
  form.elements.codigo.value=record.codigo||'';
  form.elements.descripcion.value=record.descripcion||'';
  form.elements.precioVenta.value=Number(record.precioVenta||0);
  form.elements.imagenUrl.value=record.imagenUrl||'';
  form.elements.colores.value=colors;
  form.elements.otrosColoresPedido.checked=record.otrosColoresPedido===true;
  dialog.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>dialog.close()));
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const error=dialog.querySelector('.management-dialog-error');
    const price=Number(form.elements.precioVenta.value);
    const image=String(form.elements.imagenUrl.value||'').trim();
    if(!Number.isFinite(price)||price<0){error.textContent='El precio debe ser un valor válido.';error.hidden=false;return;}
    if(image&&!/^https:\/\//i.test(image)){error.textContent='La imagen debe utilizar una dirección HTTPS.';error.hidden=false;return;}
    const previous=JSON.parse(JSON.stringify(overrides()[record.id]||{}));
    const nextFields=safeFields({
      tipoRegistro:record.tipoRegistro||'producto',
      codigo:form.elements.codigo.value.trim(),
      nombre:form.elements.nombre.value.trim(),
      descripcion:form.elements.descripcion.value.trim(),
      precioVenta:price,
      imagenUrl:image,
      colores:form.elements.colores.value.split(',').map(x=>x.trim()).filter(Boolean),
      otrosColoresPedido:form.elements.otrosColoresPedido.checked,
      productoNombre:record.productoNombre||record.nombre||'',
    });
    overrides()[record.id]={...previous,visible:previous.visible!==false,fields:nextFields};
    const submit=form.querySelector('[type="submit"]');
    submit.disabled=true;submit.textContent='Guardando…';
    try {
      const saved=await saveAppState();
      if(!saved)throw new Error('Firestore no confirmó el guardado.');
      dialog.close();
      await loadRecords();
      renderList(root);
      root.querySelector('#catalog-admin-feedback').hidden=false;
      root.querySelector('#catalog-admin-feedback').textContent='Publicación actualizada y sincronizada.';
    } catch(err) {
      overrides()[record.id]=previous;
      error.textContent='No se pudo guardar: '+err.message;error.hidden=false;
      submit.disabled=false;submit.textContent='Guardar cambios';
    }
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close();});
  document.body.append(dialog);
  dialog.showModal();
}
export async function renderCatalogManagement(root) {
  root.innerHTML='<section class="management-module catalog-admin-module"><div class="management-heading"><div><p class="eyebrow">CATÁLOGO PÚBLICO</p><h2>Gestionar publicaciones</h2><p>Edita precios, descripciones, colores e imágenes. Retira publicaciones sin borrar tus productos ni trabajos.</p></div><a class="management-button secondary" href="'+import.meta.env.BASE_URL+'#catalogo" target="_blank" rel="noopener">↗ Ver catálogo público</a></div><div id="catalog-admin-feedback" class="management-message" role="status" hidden></div><section class="management-card catalog-admin-toolbar"><label class="management-field">Buscar<input id="catalog-admin-search" type="search" placeholder="Nombre, código o descripción"></label><label class="management-field">Estado<select id="catalog-admin-status"><option value="">Todas</option><option value="publicadas">Publicadas</option><option value="retiradas">Retiradas</option></select></label><strong id="catalog-admin-count"></strong></section><div id="catalog-admin-list" class="catalog-admin-list"><p class="management-empty">Cargando publicaciones…</p></div></section>';
  try { await loadRecords(); }
  catch(error) { root.querySelector('#catalog-admin-list').innerHTML='<p class="management-empty">No se pudo leer el catálogo público: '+esc(error.message)+'</p>'; return; }
  renderList(root);
  root.querySelector('#catalog-admin-search').addEventListener('input',()=>renderList(root));
  root.querySelector('#catalog-admin-status').addEventListener('change',()=>renderList(root));
  root.querySelector('#catalog-admin-list').addEventListener('click',async event=>{
    const edit=event.target.closest('[data-catalog-edit]');
    const toggle=event.target.closest('[data-catalog-toggle]');
    if(edit) {
      const record=records.find(item=>item.id===edit.dataset.catalogEdit);
      if(record)openEditor(root,record);
      return;
    }
    if(toggle) {
      const record=records.find(item=>item.id===toggle.dataset.catalogToggle);
      if(!record)return;
      const archived=record._archived||overrides()[record.id]?.visible===false;
      const nextVisible=archived;
      if(!confirm(nextVisible?'¿Volver a publicar esta ficha?':'¿Retirar esta publicación del catálogo público? El producto y el trabajo original se conservarán.'))return;
      const previous=JSON.parse(JSON.stringify(overrides()[record.id]||{}));
      overrides()[record.id]={...previous,visible:nextVisible,fields:safeFields(previous.fields||record)};
      setSourcePublished(record.id,nextVisible);
      try {
        const saved=await saveAppState();
        if(!saved)throw new Error('Firestore no confirmó el cambio.');
        await loadRecords();renderList(root);
        root.querySelector('#catalog-admin-feedback').hidden=false;
        root.querySelector('#catalog-admin-feedback').textContent=nextVisible?'Publicación activada.':'Publicación retirada. El registro original se mantiene.';
      } catch(error) {
        overrides()[record.id]=previous;
        setSourcePublished(record.id,!nextVisible);
        alert('No se pudo actualizar la publicación: '+error.message);
      }
    }
  });
}
