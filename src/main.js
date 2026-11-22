import './styles/main.css';
import { getFirebaseStatus, isFirebaseConfigured, auth } from './services/firebase.js';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { replaceAppStateFromCloud } from './services/app-store.js';
import { readSharedState, writeSharedState, subscribeSharedState, markSharedStateDirty } from './services/cloud-store.js';
import { renderJobsView } from './modules/trabajos/jobs-view.js';
import { renderInventoryView } from './modules/inventario/inventory-view.js';
import { renderManagementView } from './modules/gestion/management-view.js';

const brandLogoUrl = import.meta.env.BASE_URL + 'imagotipo.svg';
const brandIconUrl = import.meta.env.BASE_URL + 'isotipo.svg';
const app = document.querySelector('#app');
app.innerHTML = `
  <section id="auth-screen" class="auth-screen" hidden>
    <form id="login-form" class="auth-card">
      <img class="auth-logo" src="${brandLogoUrl}" alt="Agencia de Modelos 3D" /><p class="eyebrow">ACCESO AL TALLER</p><h1>Iniciar sesión</h1>
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
      <a class="brand" href="#inicio" aria-label="Agencia de Modelos 3D inicio"><img class="brand-logo" src="${brandLogoUrl}" alt="Agencia de Modelos 3D" /></a>
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
        <a class="nav-link" href="#configuracion"><span>⚙</span> Configuración</a>
      </nav>
      <div class="sidebar-footer"><span class="status-dot"></span><span id="save-status">Esperando conexión a Firebase</span></div>
    </aside>
    <main class="main-content">
      <header class="topbar">
        <div><p class="eyebrow">AGENCIA DE MODELOS 3D</p><h1>Panel principal</h1></div>
        <div class="user-chip"><img class="avatar-logo" src="${brandIconUrl}" alt="" /><span id="user-email">AM3D</span><button id="logout-button" class="management-link" hidden type="button">Cerrar sesión</button></div>
      </header>
      <section id="jobs-root" hidden></section>
      <section id="inventory-root" hidden></section>
      <section id="management-root"></section>
      <section class="connection-panel"><div><p class="eyebrow">SERVICIOS</p><h2>Estado de almacenamiento</h2><p id="firebase-status"></p></div><span id="firebase-indicator" class="connection-indicator"></span></section>
      <footer class="page-footer">Agencia de Modelos 3D <span>·</span> Sistema de gestión para impresión 3D</footer>
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
let authGeneration=0;
let unsubscribeCloud=null;
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
    configuracion:['management','settings','Configuración'],
  };
  const route=routes[key]||routes.inicio;
  currentRoute=key;
  jobsRoot.hidden=route[0]!=='jobs';
  inventoryRoot.hidden=route[0]!=='inventory';
  managementRoot.hidden=route[0]!=='management';
  if(route[0]==='management') {
    try {
      renderManagementView(managementRoot,route[1]);
    } catch(error) {
      showModuleError(managementRoot,'Gestión',error);
    }
  }
  document.querySelector('.topbar h1').textContent=route[2];
  document.querySelectorAll('.nav-link').forEach(link=>link.classList.toggle('active',link.getAttribute('href')==='#'+key));
}
function showModuleError(root,moduleName,error) {
  console.error(`Error al inicializar el módulo ${moduleName}:`,error);
  const panel=document.createElement('section');
  panel.className='management-card';
  const heading=document.createElement('h2');
  heading.textContent=`No se pudo iniciar el módulo ${moduleName}`;
  const description=document.createElement('p');
  description.textContent='La sesión y la conexión con Firestore siguen activas. Este error pertenece a la interfaz del módulo, no demuestra un fallo de la base de datos.';
  const detail=document.createElement('pre');
  detail.className='auth-error';
  detail.style.whiteSpace='pre-wrap';
  detail.textContent=error?.stack||error?.message||String(error);
  panel.append(heading,description,detail);
  root.replaceChildren(panel);
}
function mountModules() {
  if(!modulesMounted) {
    try { renderJobsView(jobsRoot); }
    catch(error) { showModuleError(jobsRoot,'Trabajos',error); }
    try { renderInventoryView(inventoryRoot); }
    catch(error) { showModuleError(inventoryRoot,'Inventario',error); }
    modulesMounted=true;
  }
  navigate(location.hash||'#inicio');
}
async function syncCloud() {
  const generation=authGeneration;
  cloudQueue=cloudQueue.catch(()=>{}).then(()=>{
    if(!cloudSyncEnabled || generation!==authGeneration) return false;
    return writeSharedState();
  });
  try {
    const saved=await cloudQueue;
    if(!saved) return false;
    const el=document.querySelector('#save-status');
    if(el)el.textContent='Guardado en Firebase';
    setStatus('Todos los cambios están guardados en Firestore.','Tiempo real activo',true);
    return true;
  } catch(error) {
    // Mantener la sincronización habilitada permite reintentar en el siguiente cambio.
    console.error(error);
    setStatus(error.message||'No se pudo guardar en Firebase. Se volverá a intentar al próximo cambio.','Error de guardado',false);
    const el=document.querySelector('#save-status');
    if(el)el.textContent='Error: no guardado en Firebase';
    window.alert('No se pudo guardar en Firebase. No cierres ni recargues esta pestaña si necesitas recuperar los cambios que aún están en memoria.\n\n'+(error.message||'Error de sincronización'));
    return false;
  }
}
async function initializeUserSession(user,generation) {
  if(unsubscribeCloud) { unsubscribeCloud(); unsubscribeCloud=null; }
  cloudSyncEnabled=false;
  document.querySelector('#user-email').textContent=user.email||'Usuario autorizado';
  document.querySelector('#logout-button').hidden=false;
  appShell.hidden=true;
  authScreen.hidden=false;
  document.querySelector('#login-error').textContent='';
  document.querySelector('.auth-description').textContent='Conectando con los datos del taller en Firebase…';
  let remote;
  try {
    remote=await readSharedState();
  } catch(error) {
    if(generation!==authGeneration || auth.currentUser?.uid!==user.uid) return;
    cloudSyncEnabled=false;
    console.error('Error real al leer los datos de Firestore:',error);
    document.querySelector('.auth-description').textContent='No se pudo leer la base de datos de Agencia de Modelos 3D.';
    document.querySelector('#login-error').textContent=error.message||'Error al leer Firestore. Comprueba la conexión y las reglas.';
    appShell.hidden=true;
    authScreen.hidden=false;
    return;
  }
  if(generation!==authGeneration || auth.currentUser?.uid!==user.uid) return;

  try {
    replaceAppStateFromCloud(remote.data);
  } catch(error) {
    showModuleError(managementRoot,'Preparación de datos',error);
  }
  cloudSyncEnabled=true;
  setStatus(remote.exists
    ? 'Conectado. Los cambios de otros dispositivos se reflejarán automáticamente.'
    : 'Base de Agencia de Modelos 3D creada en Firestore. Sincronización en tiempo real activa.',
    'Tiempo real activo',true);

  try {
    unsubscribeCloud=subscribeSharedState(({data})=>{
      if(!cloudSyncEnabled) return;
      try {
        replaceAppStateFromCloud(data);
        const el=document.querySelector('#save-status');
        if(el)el.textContent='Sincronizado en tiempo real';
        setStatus('Los cambios de los demás dispositivos se reciben automáticamente.','Tiempo real activo',true);
      } catch(error) {
        showModuleError(managementRoot,'Actualización de datos',error);
      }
    },error=>{
      console.error('Se perdió la escucha en tiempo real de Firestore:',error);
      setStatus('No se reciben cambios en tiempo real. Los guardados se seguirán intentando.','Escucha desconectada',false);
      const el=document.querySelector('#save-status');
      if(el)el.textContent='Escucha en tiempo real desconectada';
    }, conflict=>{
      cloudSyncEnabled=false;
      const message='CONFLICTO_NUBE: otro administrador modificó los datos. Se detuvieron los guardados para proteger la información. No recargues esta pestaña si tienes cambios pendientes; conserva esta sesión y coordina la recuperación antes de continuar.';
      console.error(message, conflict);
      setStatus('Conflicto de edición detectado. Guardado bloqueado para proteger los datos.','Conflicto',false);
      const el=document.querySelector('#save-status');
      if(el)el.textContent='Conflicto: cambios no guardados';
      window.alert(message);
    });
  } catch(error) {
    console.error('No se pudo iniciar la escucha en tiempo real de Firestore:',error);
    setStatus('Lectura inicial correcta; escucha en tiempo real no disponible.','Escucha desconectada',false);
  }

  mountModules();
  appShell.hidden=false;
  authScreen.hidden=true;
  document.querySelector('.auth-description').textContent='Inicia sesión con la cuenta autorizada del taller.';
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
  markSharedStateDirty();
  const el=document.querySelector('#save-status');
  if(el)el.textContent='Guardando en Firebase…';
  if(cloudSyncEnabled) event.detail.persistence=syncCloud();
  else {
    if(el)el.textContent='Sin conexión a Firebase: cambio no guardado';
    event.detail.persistence=Promise.resolve(false);
  }
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
    authGeneration++;
    cloudSyncEnabled=false;
    if(unsubscribeCloud) { unsubscribeCloud(); unsubscribeCloud=null; }
    await signOut(auth);
  });
  onAuthStateChanged(auth,user=>{
    const generation=++authGeneration;
    if(user)initializeUserSession(user,generation);
    else {
      cloudSyncEnabled=false;
      if(unsubscribeCloud) { unsubscribeCloud(); unsubscribeCloud=null; }
      appShell.hidden=true;
      authScreen.hidden=false;
      document.querySelector('#logout-button').hidden=true;
      document.querySelector('#user-email').textContent='AM3D';
    }
  });
} else {
  cloudSyncEnabled=false;
  appShell.hidden=true;
  authScreen.hidden=false;
  document.querySelector('#login-form').hidden=true;
  document.querySelector('.auth-description').textContent='Firebase es obligatorio para utilizar Agencia de Modelos 3D. Configura las credenciales de conexión para continuar.';
  document.querySelector('#login-error').textContent=getFirebaseStatus().message;
}

if('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load',()=>{
    navigator.serviceWorker.register(import.meta.env.BASE_URL+'sw.js').catch(error=>{
      console.warn('No se pudo activar el modo instalable/offline de Agencia de Modelos 3D:',error);
    });
  });
}
