import './styles/main.css';
import { getFirebaseStatus } from './services/firebase.js';
import { renderJobsView } from './modules/trabajos/jobs-view.js';
import { renderInventoryView } from './modules/inventario/inventory-view.js';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" aria-label="Plastiquería inicio">
        <span class="brand-mark">P</span>
        <span>Plastiquería</span>
      </a>
      <p class="nav-caption">GESTIÓN</p>
      <nav class="navigation" aria-label="Navegación principal">
        <a class="nav-link" href="#inicio"><span>▦</span> Panel principal</a>
        <a class="nav-link active" href="#trabajos"><span>▤</span> Trabajos</a>
        <a class="nav-link" href="#productos"><span>◇</span> Productos</a>
        <a class="nav-link" href="#inventario"><span>▥</span> Inventario</a>
        <a class="nav-link" href="#compras"><span>＋</span> Compras</a>
        <a class="nav-link" href="#ventas"><span>↗</span> Ventas</a>
        <a class="nav-link" href="#clientes"><span>♙</span> Clientes</a>
        <a class="nav-link" href="#consignaciones"><span>⇄</span> Consignaciones</a>
      </nav>
      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span>Entorno inicial</span>
      </div>
    </aside>

    <main class="main-content">
      <header class="topbar">
        <div>
          <p class="eyebrow">TALLER DE IMPRESIÓN 3D</p>
          <h1>Trabajos</h1>
        </div>
        <div class="user-chip"><span class="avatar">P</span><span>Plastiquería</span></div>
      </header>

      <section id="jobs-root"></section>
      <section id="inventory-root" hidden></section>

      <section class="connection-panel">
        <div>
          <p class="eyebrow">SERVICIOS</p>
          <h2>Conexión con Firebase</h2>
          <p id="firebase-status">Comprobando configuración…</p>
        </div>
        <span id="firebase-indicator" class="connection-indicator">Inicializando</span>
      </section>

      <footer class="page-footer">Plastiquería <span>·</span> Sistema de gestión para impresión 3D</footer>
    </main>
  </div>
`;

const status = getFirebaseStatus();
document.querySelector('#firebase-status').textContent = status.message;
document.querySelector('#firebase-indicator').textContent = status.label;
document.querySelector('#firebase-indicator').className = `connection-indicator ${status.configured ? 'is-ready' : 'is-pending'}`;


const jobsRoot = document.querySelector('#jobs-root');
const inventoryRoot = document.querySelector('#inventory-root');
renderJobsView(jobsRoot);
renderInventoryView(inventoryRoot);

const navLinks = [...document.querySelectorAll('.nav-link')];
function showSection(section, activeLink) {
  const inventoryVisible = section === 'inventory';
  jobsRoot.hidden = inventoryVisible;
  inventoryRoot.hidden = !inventoryVisible;
  navLinks.forEach(item => item.classList.toggle('active', item === activeLink));
  document.querySelector('.topbar h1').textContent =
    section === 'jobs' ? 'Trabajos' :
    section === 'inventory' ? (activeLink?.getAttribute('href') === '#compras' ? 'Compras' : 'Inventario') :
    'Panel principal';
}
navLinks.forEach(link => {
  link.addEventListener('click', event => {
    const href = link.getAttribute('href');
    if (['#trabajos', '#inicio', '#inventario', '#compras'].includes(href)) {
      event.preventDefault();
      showSection(href === '#inventario' || href === '#compras' ? 'inventory' : 'jobs', link);
      window.location.hash = href.slice(1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      event.preventDefault();
      window.alert('Este módulo todavía está pendiente de migración.');
    }
  });
});
