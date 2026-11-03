import './styles/main.css';
import { getFirebaseStatus, isFirebaseConfigured, auth } from './services/firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { loadAppState, hasAppData, replaceAppStateFromCloud } from './services/app-store.js';
import { readSharedState, writeSharedState } from './services/cloud-store.js';
import { renderJobsView } from './modules/trabajos/jobs-view.js';
import { renderInventoryView } from './modules/inventario/inventory-view.js';
import { renderManagementView } from './modules/gestion/management-view.js';

loadAppState();
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
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span><span id="save-status">Almacenamiento local activo</span></div>
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
  cloudQueue=cloudQueue.then(()=>writeSharedState());
  try {
    await cloudQueue;
    const el=document.querySelector('#save-status');
    if(el)el.textContent='Guardado local y sincronizado';
    return true;
  } catch(error) {
    cloudSyncEnabled=false;
    console.error(error);
    setStatus(error.message||'No se pudo sincronizar. Los datos locales se conservaron.','Conflicto / revisar',false);
    const el=document.querySelector('#save-status');
    if(el)el.textContent='Guardado local · nube pendiente';
    return false;
  }
}
async function initializeUserSession(user) {
  document.querySelector('#user-email').textContent=user.email||'Usuario autorizado';
  document.querySelector('#logout-button').hidden=false;
  setStatus('Leyendo el documento compartido talleres3dboys/principal…','Conectando',false);
  try {
    const remote=await readSharedState();
    const localHas=hasAppData();
    if(remote.hasRecords && !localHas) {
      replaceAppStateFromCloud(remote.data);
      cloudSyncEnabled=true;
      setStatus('Datos cargados desde el documento compartido del taller.','Nube activa',true);
    } else if(remote.hasRecords && localHas) {
      const useCloud=window.confirm('Hay datos tanto en este navegador como en Firebase.\n\nAceptar: cargar los datos compartidos de Firebase y reemplazar los datos locales actuales.\nCancelar: conservar los datos locales y elegir después si deseas subirlos.');
      if(useCloud) {
        replaceAppStateFromCloud(remote.data);
        cloudSyncEnabled=true;
        setStatus('Datos compartidos cargados desde Firebase.','Nube activa',true);
      } else {
        const upload=window.confirm('¿Deseas subir los datos locales y reemplazar las listas compartidas de Firebase? Asegúrate de tener un respaldo de ambas fuentes.');
        if(upload) {
          cloudSyncEnabled=true;
          await syncCloud();
        } else {
          cloudSyncEnabled=false;
          setStatus('Sesión iniciada. Se conservan los datos locales; sincronización desactivada para evitar sobrescrituras.','Modo local',false);
        }
      }
    } else if(localHas) {
      const upload=window.confirm('El documento compartido no contiene registros. ¿Deseas subir los datos locales a Firebase?');
      if(upload) {
        cloudSyncEnabled=true;
        const synced=await syncCloud();
        if(synced) setStatus('Datos locales enviados al documento compartido.','Nube activa',true);
      } else {
        cloudSyncEnabled=false;
        setStatus('Sesión iniciada en modo local. No se modificó Firebase.','Modo local',false);
      }
    } else {
      cloudSyncEnabled=true;
      setStatus('Conectado. Los cambios se sincronizarán con el documento compartido.','Nube activa',true);
    }
  } catch(error) {
    cloudSyncEnabled=false;
    console.error(error);
    setStatus('No se pudo leer Firestore. Los datos locales siguen disponibles: '+(error.message||''),'Solo local',false);
  }
  mountModules();
  appShell.hidden=false;
  authScreen.hidden=true;
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
window.addEventListener('plastiqueria:saved',event=>{
  const el=document.querySelector('#save-status');
  if(el)el.textContent='Guardado local · '+new Date(event.detail.savedAt).toLocaleTimeString('es-BO',{hour:'2-digit',minute:'2-digit'});
  if(cloudSyncEnabled)syncCloud();
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
  authScreen.hidden=true;
  appShell.hidden=false;
  const status=getFirebaseStatus();
  setStatus(status.message,'Almacenamiento local',false);
  mountModules();
}

if('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js').catch(error=>{
      console.warn('No se pudo activar el modo instalable/offline de Plastiquería:',error);
    });
  });
}
