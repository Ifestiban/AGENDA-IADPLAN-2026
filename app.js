const events = (window.__EVENTS__ || []).map(e => ({
  ...e,
  startDate: new Date(e.dateStart + "T09:00:00"),
  endDate: new Date(e.dateEnd + "T18:00:00")
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
let swRegistration = null;

init();

function init(){
  fillMonthFilter();
  bind();
  restoreSettings();
  updateUI();
  registerSW();
  startReminderLoop();
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
function diffDays(a,b){ return Math.floor((stripTime(a)-stripTime(b))/(24*60*60*1000)); }

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

  refs.totalCount.textContent = events.length;
  refs.todayCount.textContent = events.filter(e => today >= stripTime(e.startDate) && today <= stripTime(e.endDate)).length;
  refs.weekCount.textContent = events.filter(e => e.startDate >= today && e.startDate <= plus7).length;
  refs.resultsInfo.textContent = `${filtered.length} resultado(s)`;

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
    alert('Sem suporte a notificações.');
    return;
  }

  const permission = await Notification.requestPermission();

  if(permission === 'granted'){
    localStorage.setItem('iadplan-notifications', 'on');
    alert('Notificações ativadas!');
  }
}

function startReminderLoop(){
  checkReminders();
  setInterval(checkReminders, 30000); // mais rápido (30s)
}

async function checkReminders(){
  if(localStorage.getItem('iadplan-notifications') !== 'on') return;
  if(Notification.permission !== 'granted') return;
  if(!swRegistration) return;

  const leadDays = Number(refs.leadTime.value || 7);
  const today = stripTime(new Date());

  const sentKey = "iadplan-sent";
  const sent = JSON.parse(localStorage.getItem(sentKey) || "[]");

  const due = events.filter(event=>{
    const d = diffDays(event.startDate, today);
    return d >= 0 && d <= leadDays;
  });

  for(const event of due){
    if(sent.includes(event.id)) continue;

    await swRegistration.showNotification("Evento próximo", {
      body: `${event.title} • ${formatEventDate(event)}`,
      icon: "icon-192.png",
      tag: event.id,
      renotify: true
    });

    sent.push(event.id);
  }

  localStorage.setItem(sentKey, JSON.stringify(sent));
}

function registerSW(){
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js")
      .then(reg=>{
        swRegistration = reg;
      })
      .catch(err=>console.error("SW erro:", err));
  }
}
