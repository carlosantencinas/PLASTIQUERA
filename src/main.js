import './styles/main.css';
import { getFirebaseStatus } from './services/firebase.js';

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
        <a class="nav-link active" href="#inicio"><span>▦</span> Panel principal</a>
        <a class="nav-link" href="#trabajos"><span>▤</span> Trabajos</a>
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
          <h1>Panel principal</h1>
        </div>
        <div class="user-chip"><span class="avatar">P</span><span>Plastiquería</span></div>
      </header>

      <section class="welcome">
        <div>
          <p class="eyebrow">BIENVENIDO</p>
          <h2>De la idea a la pieza terminada.</h2>
          <p>Estamos preparando tu espacio de trabajo. Los módulos se incorporarán progresivamente conservando la lógica de 3DBoys.</p>
        </div>
        <div class="welcome-shape" aria-hidden="true">▧</div>
      </section>

      <section class="section-heading">
        <div>
          <p class="eyebrow">RESUMEN</p>
          <h2>Tu taller, en un solo lugar</h2>
        </div>
        <span class="phase-tag">Versión inicial · 0.1</span>
      </section>

      <section class="module-grid" aria-label="Módulos del sistema">
        <article class="module-card"><span class="module-icon">▤</span><h3>Trabajos</h3><p>Órdenes, costos y seguimiento de impresión.</p><span class="module-state">En preparación</span></article>
        <article class="module-card"><span class="module-icon">◇</span><h3>Productos</h3><p>Catálogo y piezas listas para vender.</p><span class="module-state">En preparación</span></article>
        <article class="module-card"><span class="module-icon">▥</span><h3>Inventario</h3><p>Filamentos, insumos y existencias.</p><span class="module-state">En preparación</span></article>
        <article class="module-card"><span class="module-icon">↗</span><h3>Ventas</h3><p>Registro de ventas y comprobantes.</p><span class="module-state">En preparación</span></article>
      </section>

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
