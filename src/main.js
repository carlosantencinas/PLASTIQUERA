import './styles/main.css';
import { getFirebaseStatus } from './services/firebase.js';
import { loadAppState } from './services/app-store.js';
import { renderJobsView } from './modules/trabajos/jobs-view.js';
import { renderInventoryView } from './modules/inventario/inventory-view.js';
import { renderManagementView } from './modules/gestion/management-view.js';

loadAppState();

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#inicio" aria-label="Plastiquería inicio"><span class="brand-mark">P</span><span>Plastiquería</span></a>
      <p class="nav-caption">GESTIÓN</p>
      <nav class="navigation" aria-label="Navegación principal">
        <a class="nav-link" href="#inicio"><span>▦</span> Panel principal</a>
        <a class="nav-link" href="#trabajos"><span>▤</span> Trabajos</a>
        <a class="nav-link" href="#productos"><span>◇</span> Productos</a>
        <a class="nav-link" href="#inventario"><span>▥</span> Inventario</a>
        <a class="nav-link" href="#compras"><span>＋</span> Compras</a>
        <a class="nav-link" href="#ventas"><span>↗</span> Ventas</a>
        <a class="nav-link" href="#clientes"><span>♙</span> Clientes</a>
        <a class="nav-link" href="#consignaciones"><span>⇄</span> Consignaciones</a>
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span><span id="save-status">Almacenamiento local activo</span></div>
    </aside>
    <main class="main-content">
      <header class="topbar"><div><p class="eyebrow">TALLER DE IMPRESIÓN 3D</p><h1>Panel principal</h1></div><div class="user-chip"><span class="avatar">P</span><span>Plastiquería</span></div></header>
      <section id="jobs-root" hidden></section>
      <section id="inventory-root" hidden></section>
      <section id="management-root"></section>
      <section class="connection-panel"><div><p class="eyebrow">SERVICIOS</p><h2>Estado de Firebase</h2><p id="firebase-status"></p></div><span id="firebase-indicator" class="connection-indicator"></span></section>
      <footer class="page-footer">Plastiquería <span>·</span> Sistema de gestión para impresión 3D</footer>
    </main>
  </div>`;
const jobsRoot=document.querySelector('#jobs-root');
const inventoryRoot=document.querySelector('#inventory-root');
const managementRoot=document.querySelector('#management-root');
renderJobsView(jobsRoot);
renderInventoryView(inventoryRoot);
const status=getFirebaseStatus();
document.querySelector('#firebase-status').textContent=status.message;
document.querySelector('#firebase-indicator').textContent=status.label;
document.querySelector('#firebase-indicator').className=`connection-indicator ${status.configured?'is-ready':'is-pending'}`;

const routes={
  inicio:['management','dashboard','Panel principal'],
  trabajos:['jobs',null,'Trabajos'],
  productos:['management','products','Productos'],
  inventario:['inventory',null,'Inventario'],
  compras:['inventory',null,'Compras'],
  ventas:['management','sales','Ventas'],
  clientes:['management','clients','Clientes'],
  consignaciones:['management','consignments','Consignaciones'],
};
function navigate(hash) {
  const key=(hash||'inicio').replace(/^#/,'');
  const route=routes[key]||routes.inicio;
  jobsRoot.hidden=route[0]!=='jobs';
  inventoryRoot.hidden=route[0]!=='inventory';
  managementRoot.hidden=route[0]!=='management';
  if(route[0]==='management')renderManagementView(managementRoot,route[1]);
  document.querySelector('.topbar h1').textContent=route[2];
  document.querySelectorAll('.nav-link').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#'+key));
}
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();const hash=link.getAttribute('href');if(location.hash!==hash)history.pushState(null,'',hash);navigate(hash);window.scrollTo({top:0,behavior:'smooth'});
}));
window.addEventListener('popstate',()=>navigate(location.hash));
window.addEventListener('hashchange',()=>navigate(location.hash));
window.addEventListener('plastiqueria:saved',e=>{
  const el=document.querySelector('#save-status');if(el)el.textContent='Guardado · '+new Date(e.detail.savedAt).toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'});
});
navigate(location.hash||'#inicio');


if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(error => {
      console.warn('No se pudo activar el modo instalable/offline de Plastiquería:', error);
    });
  });
}
