
const events = (window.__EVENTS__ || []).map(e => ({
  ...e,
  startDate: new Date(`${e.dateStart}T09:00:00`),
  endDate: new Date(`${e.dateEnd}T18:00:00`)
})).sort((a,b) => a.startDate - b.startDate);

const refs = {
  heroTitle: document.getElementById('heroTitle'),
  heroMeta: document.getElementById('heroMeta'),
  todayCount: document.getElementById('todayCount'),
  weekCount: document.getElementById('weekCount'),
  totalCount: document.getElementById('totalCount'),
  eventList: document.getElementById('eventList'),
  searchInput: document.getElementById('searchInput'),
  monthFilter: document.getElementById('monthFilter'),
  leadTime: document.getElementById('leadTime'),
  onlyUpcoming: document.getElementById('onlyUpcoming'),
  resultsInfo: document.getElementById('resultsInfo'),
  enableNotificationsBtn: document.getElementById('enableNotificationsBtn'),
  installBtn: document.getElementById('installBtn'),
};

let deferredPrompt = null;
let navFilter = 'all';

init();

function init(){
  fillMonthFilter();
  bind();
  restoreSettings();
  updateUI();
  startReminderLoop();
  registerSW();
}

function fillMonthFilter(){
  const labels = [
    ['all','Todos os meses'],
    ['01','Janeiro'],['02','Fevereiro'],['03','Março'],['04','Abril'],
    ['05','Maio'],['06','Junho'],['07','Julho'],['08','Agosto'],
    ['09','Setembro'],['10','Outubro'],['11','Novembro'],['12','Dezembro']
  ];
  refs.monthFilter.innerHTML = labels.map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
}

function bind(){
  refs.searchInput.addEventListener('input', updateUI);
  refs.monthFilter.addEventListener('change', ()=>{saveSettings(); updateUI();});
  refs.leadTime.addEventListener('change', saveSettings);
  refs.onlyUpcoming.addEventListener('change', ()=>{saveSettings(); updateUI();});
  refs.enableNotificationsBtn.addEventListener('click', enableNotifications);

  document.querySelectorAll('.nav-item').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      navFilter = btn.dataset.filter;
      updateUI();
    });
  });

  window.addEventListener('beforeinstallprompt', (e)=>{
    e.preventDefault();
    deferredPrompt = e;
    refs.installBtn.classList.remove('hidden');
  });

  refs.installBtn.addEventListener('click', async ()=>{
    if(!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    refs.installBtn.classList.add('hidden');
    deferredPrompt = null;
  });
}

function saveSettings(){
  localStorage.setItem('iadplan-ui-settings', JSON.stringify({
    month: refs.monthFilter.value,
    lead: refs.leadTime.value,
    onlyUpcoming: refs.onlyUpcoming.checked
  }));
}
function restoreSettings(){
  try{
    const s = JSON.parse(localStorage.getItem('iadplan-ui-settings') || '{}');
    if(s.month) refs.monthFilter.value = s.month;
    if(s.lead) refs.leadTime.value = s.lead;
    refs.onlyUpcoming.checked = !!s.onlyUpcoming;
  }catch(e){}
}

function stripTime(d){ return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function diffDays(a,b){ return Math.round((stripTime(a)-stripTime(b))/(24*60*60*1000)); }

function formatEventDate(event){
  return event.dayStart === event.dayEnd
    ? `${String(event.dayStart).padStart(2,'0')} ${event.monthName}`
    : `${String(event.dayStart).padStart(2,'0')} a ${String(event.dayEnd).padStart(2,'0')} ${event.monthName}`;
}

function updateUI(){
  const now = new Date();
  const today = stripTime(now);
  const plus7 = addDays(today, 7);

  const filtered = events.filter(event=>{
    const q = refs.searchInput.value.trim().toLowerCase();
    if(q && !(`${event.title} ${event.local}`.toLowerCase().includes(q))) return false;
    if(refs.monthFilter.value !== 'all' && event.month !== refs.monthFilter.value) return false;
    if(refs.onlyUpcoming.checked && event.endDate < today) return false;
    if(navFilter === 'upcoming' && event.endDate < today) return false;
    if(navFilter === 'sede' && !event.local.toUpperCase().includes('SEDE')) return false;
    return true;
  });

  const next = events.filter(e=>e.endDate >= today).sort((a,b)=>a.startDate-b.startDate)[0];
  if(next){
    refs.heroTitle.textContent = next.title;
    refs.heroMeta.textContent = `${formatEventDate(next)} • Local: ${next.local}`;
  } else {
    refs.heroTitle.textContent = 'Nenhum próximo evento';
    refs.heroMeta.textContent = 'Cadastre novos eventos.';
  }

  refs.totalCount.textContent = String(events.length);
  refs.todayCount.textContent = String(events.filter(e => today >= stripTime(e.startDate) && today <= stripTime(e.endDate)).length);
  refs.weekCount.textContent = String(events.filter(e => e.startDate >= today && e.startDate <= plus7).length);

  refs.resultsInfo.textContent = `${filtered.length} resultado(s)`;

  if(!filtered.length){
    refs.eventList.innerHTML = '<div class="card empty">Nenhum evento encontrado com os filtros atuais.</div>';
    return;
  }

  refs.eventList.innerHTML = filtered.map(event=>{
    const daysLeft = diffDays(event.startDate, today);
    const tag = daysLeft >= 0 && daysLeft <= 7 ? `<span class="tag alert">Faltam ${daysLeft} dia(s)</span>` : '';
    return `
      <article class="card event-card">
        <div class="event-title">${event.title}</div>
        <div class="event-date">${formatEventDate(event)}</div>
        <div class="event-meta">
          <span class="tag">Local: ${event.local}</span>
          ${tag}
        </div>
      </article>
    `;
  }).join('');
}

async function enableNotifications(){
  if(!('Notification' in window)){
    alert('Este aparelho não suporta notificações no navegador.');
    return;
  }
  const result = await Notification.requestPermission();
  if(result === 'granted'){
    localStorage.setItem('iadplan-notifications', 'on');
    alert('Lembretes ativados no navegador.');
  }
}

function startReminderLoop(){
  checkReminders();
  setInterval(checkReminders, 60000);
}

function checkReminders(){
  if(localStorage.getItem('iadplan-notifications') !== 'on') return;
  if(Notification.permission !== 'granted') return;

  const leadDays = Number(refs.leadTime.value || 7);
  const today = stripTime(new Date());
  const key = `iadplan-reminders-${today.toISOString().slice(0,10)}-${leadDays}`;
  const already = JSON.parse(localStorage.getItem(key) || '[]');

  const due = events.filter(event=>{
    const d = diffDays(event.startDate, today);
    return d >= 0 && d <= leadDays;
  });

  due.forEach(event=>{
    if(already.includes(event.id)) return;
    new Notification('IADPLAN • Evento próximo', {
      body: `${event.title} • ${formatEventDate(event)} • ${event.local}`,
      icon: 'icon-192.png'
    });
    already.push(event.id);
  });

  localStorage.setItem(key, JSON.stringify(already));
}

function registerSW(){}
let newWorker = null;

function showUpdateBanner() {
  if (document.getElementById("updateBanner")) return;

  const banner = document.createElement("div");
  banner.id = "updateBanner";
  banner.innerHTML = `
    <div style="
      position: fixed;
      left: 16px;
      right: 16px;
      bottom: 16px;
      z-index: 9999;
      background: #09111f;
      color: #fff;
      padding: 14px 16px;
      border-radius: 14px;
      box-shadow: 0 8px 24px rgba(0,0,0,.25);
      display: flex;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
      font-family: sans-serif;
    ">
      <span>Nova versão da agenda disponível.</span>
      <button id="updateNowBtn" style="
        background: #fff;
        color: #09111f;
        border: none;
        border-radius: 10px;
        padding: 8px 14px;
        font-weight: 600;
        cursor: pointer;
      ">Atualizar</button>
    </div>
  `;

  document.body.appendChild(banner);

  document.getElementById("updateNowBtn").addEventListener("click", () => {
    if (newWorker) {
      newWorker.postMessage({ type: "SKIP_WAITING" });
    }
  });
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").then(reg => {
    if (reg.waiting) {
      newWorker = reg.waiting;
      showUpdateBanner();
    }

    reg.addEventListener("updatefound", () => {
      const installingWorker = reg.installing;
      if (!installingWorker) return;

      installingWorker.addEventListener("statechange", () => {
        if (
          installingWorker.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          newWorker = installingWorker;
          showUpdateBanner();
        }
      });
    });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      window.location.reload();
    });
  });
}
