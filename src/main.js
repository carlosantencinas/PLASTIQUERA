import './styles/main.css';
import { getFirebaseStatus, isFirebaseConfigured, auth } from './services/firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { replaceAppStateFromCloud } from './services/app-store.js';
import { readSharedState, writeSharedState } from './services/cloud-store.js';
import { renderJobsView } from './modules/trabajos/jobs-view.js';
import { renderInventoryView } from './modules/inventario/inventory-view.js';
import { renderManagementView } from './modules/gestion/management-view.js';

const app = document.querySelector('#app');
app.innerHTML = `
  <section id="auth-screen" class="auth-screen" hidden>
    <form id="login-form" class="auth-card">
      <div class="auth-brand">P</div><p class="eyebrow">ACCESO AL TALLER</p><h1>Plastiquería</h1>
      <p class="auth-description">Inicia sesión con la cuenta autorizada del taller.</p>
      <label>Correo electrónico<input name="email" type="email" autocomplete="username" required></label>
      <label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label>
      <button class="management-button" type="submit" id="login-submit">Ingresar</button>
      <p id="login-error" class="auth-error" role="alert"></p>
      <small>El registro público está deshabilitado. Solicita al administrador que cree tu usuario.</small>
    </form>
  </section>
  <div class="app-shell" id="app-shell">
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
        <a class="nav-link" href="#finanzas"><span>▣</span> Finanzas</a>
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span><span id="save-status">Esperando conexión a Firebase</span></div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <div><p class="eyebrow">TALLER DE IMPRESIÓN 3D</p><h1>Panel principal</h1></div>
        <div class="user-chip"><span class="avatar">P</span><span id="user-email">Plastiquería</span><button id="logout-button" class="management-link" hidden type="button">Cerrar sesión</button></div>
      </header>
      <section id="jobs-root" hidden></section>
      <section id="inventory-root" hidden></section>
      <section id="management-root"></section>
      <section class="connection-panel"><div><p class="eyebrow">SERVICIOS</p><h2>Estado de almacenamiento</h2><p id="firebase-status"></p></div><span id="firebase-indicator" class="connection-indicator"></span></section>
      <footer class="page-footer">Plastiquería <span>·</span> Sistema de gestión para impresión 3D</footer>
    </main>
  </div>`;
const authScreen=document.querySelector('#auth-screen');
const appShell=document.querySelector('#app-shell');
const jobsRoot=document.querySelector('#jobs-root');
const inventoryRoot=document.querySelector('#inventory-root');
const managementRoot=document.querySelector('#management-root');
const statusText=document.querySelector('#firebase-status');
const statusBadge=document.querySelector('#firebase-indicator');
let cloudSyncEnabled=false;
let cloudQueue=Promise.resolve();
let currentRoute='inicio';
let modulesMounted=false;

function setStatus(message,label='Local',ready=false) {
  statusText.textContent=message;
  statusBadge.textContent=label;
  statusBadge.className='connection-indicator '+(ready?'is-ready':'is-pending');
}
function navigate(hash) {
  const key=(hash||'inicio').replace(/^#/,'');
  const routes={
    inicio:['management','dashboard','Panel principal'],
    trabajos:['jobs',null,'Trabajos'],
    productos:['management','products','Productos'],
    inventario:['inventory',null,'Inventario'],
    compras:['inventory',null,'Compras'],
    ventas:['management','sales','Ventas'],
    clientes:['management','clients','Clientes'],
    consignaciones:['management','consignments','Consignaciones'],
    finanzas:['management','finance','Finanzas'],
  };
  const route=routes[key]||routes.inicio;
  currentRoute=key;
  jobsRoot.hidden=route[0]!=='jobs';
  inventoryRoot.hidden=route[0]!=='inventory';
  managementRoot.hidden=route[0]!=='management';
  if(route[0]==='management')renderManagementView(managementRoot,route[1]);
  document.querySelector('.topbar h1').textContent=route[2];
  document.querySelectorAll('.nav-link').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#'+key));
}
function mountModules() {
  if(!modulesMounted) {
    renderJobsView(jobsRoot);
    renderInventoryView(inventoryRoot);
    modulesMounted=true;
  }
  navigate(location.hash||'#inicio');
}
async function syncCloud() {
  cloudQueue=cloudQueue.catch(()=>{}).then(()=>writeSharedState());
  try {
    await cloudQueue;
    const el=document.querySelector('#save-status');
    if(el)el.textContent='Guardado en Firebase';
    setStatus('Todos los cambios están guardados en Firestore.','Nube activa',true);
    return true;
  } catch(error) {
    cloudSyncEnabled=false;
    console.error(error);
    setStatus(error.message||'No se pudo guardar en Firebase. Recarga para recuperar la última versión confirmada.','Conflicto / revisar',false);
    const el=document.querySelector('#save-status');
    if(el)el.textContent='Error: no guardado en Firebase';
    window.alert('No se pudo guardar en Firebase. No cierres ni recargues esta pestaña si necesitas recuperar los cambios que aún están en memoria.\n\n'+(error.message||'Error de sincronización'));
    return false;
  }
}
async function initializeUserSession(user) {
  document.querySelector('#user-email').textContent=user.email||'Usuario autorizado';
  document.querySelector('#logout-button').hidden=false;
  appShell.hidden=true;
  authScreen.hidden=false;
  document.querySelector('#login-error').textContent='';
  document.querySelector('.auth-description').textContent='Conectando con los datos del taller en Firebase…';
  try {
    const remote=await readSharedState();
    replaceAppStateFromCloud(remote.data);
    cloudSyncEnabled=true;
    setStatus(remote.exists
      ? 'Datos cargados desde Firestore. Los cambios se guardarán en la nube.'
      : 'Base de Plastiquería creada y vacía en Firestore. Los cambios se guardarán en la nube.',
      'Nube activa',true);
    mountModules();
    appShell.hidden=false;
    authScreen.hidden=true;
    document.querySelector('.auth-description').textContent='Inicia sesión con la cuenta autorizada del taller.';
  } catch(error) {
    cloudSyncEnabled=false;
    console.error(error);
    document.querySelector('.auth-description').textContent='No se pudo conectar con la base de datos de Plastiquería.';
    document.querySelector('#login-error').textContent=error.message||'Error al leer Firestore. Comprueba las reglas y vuelve a intentar.';
    appShell.hidden=true;
    authScreen.hidden=false;
  }
}
document.querySelectorAll('.nav-link').forEach(link=>link.addEventListener('click',event=>{
  event.preventDefault();
  const hash=link.getAttribute('href');
  if(location.hash!==hash)history.pushState(null,'',hash);
  navigate(hash);
  window.scrollTo({top:0,behavior:'smooth'});
}));
window.addEventListener('popstate',()=>navigate(location.hash));
window.addEventListener('hashchange',()=>navigate(location.hash));
window.addEventListener('plastiqueria:saved',()=>{
  const el=document.querySelector('#save-status');
  if(el)el.textContent='Guardando en Firebase…';
  if(cloudSyncEnabled)syncCloud();
  else if(el)el.textContent='Sin conexión a Firebase: cambio no guardado';
});
window.addEventListener('appstate:loaded',()=>{
  if(modulesMounted) {
    window.dispatchEvent(new Event('inventory:updated'));
    navigate('#'+currentRoute);
  }
});

if(isFirebaseConfigured) {
  appShell.hidden=true;
  authScreen.hidden=false;
  document.querySelector('#login-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const button=document.querySelector('#login-submit');
    const error=document.querySelector('#login-error');
    button.disabled=true;button.textContent='Ingresando…';error.textContent='';
    try {
      await signInWithEmailAndPassword(auth,form.elements.email.value.trim(),form.elements.password.value);
    } catch(err) {
      error.textContent=err.code==='auth/invalid-credential'?'Correo o contraseña incorrectos.':err.message;
    } finally {
      button.disabled=false;button.textContent='Ingresar';
    }
  });
  document.querySelector('#logout-button').addEventListener('click',async()=>{
    cloudSyncEnabled=false;
    await signOut(auth);
  });
  onAuthStateChanged(auth,user=>{
    if(user)initializeUserSession(user);
    else {
      cloudSyncEnabled=false;
      appShell.hidden=true;
      authScreen.hidden=false;
      document.querySelector('#logout-button').hidden=true;
      document.querySelector('#user-email').textContent='Plastiquería';
    }
  });
} else {
  cloudSyncEnabled=false;
  appShell.hidden=true;
  authScreen.hidden=false;
  document.querySelector('#login-form').hidden=true;
  document.querySelector('.auth-description').textContent='Firebase es obligatorio para utilizar Plastiquería. Configura las credenciales de conexión para continuar.';
  document.querySelector('#login-error').textContent=getFirebaseStatus().message;
}

if('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js').catch(error=>{
      console.warn('No se pudo activar el modo instalable/offline de Plastiquería:',error);
    });
  });
}
