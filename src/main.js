// Vanguard Navigator — point d'entrée : relie carte, recherche, itinéraires, guidage et interface.
import './style.css';
import { CONFIG } from './config.js';
import { settings, saveSettings, places, savePlaces, addRecent } from './storage.js';
import * as map from './map.js';
import { searchPlaces, reverseGeocode } from './search.js';
import { fetchRoutes } from './routing.js';
import { loadRadars } from './radars.js';
import { Guidance } from './guidance.js';
import { isNight, haversine } from './geo.js';
import { fmtDistance, fmtDuration, fmtClock, fmtSpeed, speedUnit } from './format.js';
import * as native from './native.js';
import { $, setText, initSheet, showView, toast, hideToast, ask, closeDialog, maneuverIcon } from './ui.js';

const state = {
  fix: null, // dernière position GPS { lon, lat, accuracy, speed, heading, time }
  locError: null,
  view: 'home',
  place: null, // lieu choisi par appui long
  trip: null, // { from: lieu | null (= ma position), to: lieu, routes: [], active: 0 }
  nextFrom: null, // départ choisi avant la destination (« Partir d'ici »)
  pendingRoute: false,
  nav: null, // { guidance, dest, rerouting, lastReroute }
  night: null,
  searchMode: 'dest',
};

const ERRORS = {
  offline: 'Pas de connexion Internet. Vérifiez votre réseau puis réessayez.',
  timeout: 'Le serveur met trop de temps à répondre. Réessayez.',
  noroute: 'Aucun itinéraire routier trouvé vers cette destination.',
  nolocation: 'Ce point n’est pas accessible en voiture. Choisissez un point sur une route.',
  toofar: 'Trajet trop long pour le serveur d’itinéraires.',
  server: 'Service momentanément indisponible. Réessayez dans un instant.',
};
const errText = (e) => ERRORS[e?.kind] || ERRORS.server;
const isDest = (m) => m.type >= 4 && m.type <= 6;
const routeOpts = () => ({
  units: settings.units,
  avoidHighways: settings.avoidHighways,
  avoidTolls: settings.avoidTolls,
  avoidFerries: settings.avoidFerries,
});

// ── Thème jour / nuit ───────────────────────────────────────
function applyTheme() {
  const pos = state.fix || places.lastPos;
  const night =
    settings.theme === 'night' ||
    (settings.theme === 'auto' && (pos ? isNight(new Date(), pos.lat, pos.lon) : matchMedia('(prefers-color-scheme: dark)').matches));
  if (night === state.night) return;
  state.night = night;
  document.documentElement.dataset.theme = night ? 'dark' : 'light';
  native.setStatusBar(night, night ? '#161C2C' : '#FFFFFF');
  if (map.getMap()) map.setMapStyle({ night });
}

// ── Démarrage ───────────────────────────────────────────────
applyTheme();
const last = places.lastPos;
map.initMap('map', {
  night: state.night,
  satellite: settings.mapType === 'satellite',
  center: last ? [last.lon, last.lat] : CONFIG.map.defaultCenter,
  zoom: last ? 15 : CONFIG.map.defaultZoom,
});
map.getMap().once('load', native.hideSplash);
setTimeout(native.hideSplash, 3000); // hors-ligne, « load » peut ne jamais arriver
map.bindCompass($('#btn-compass'));
map.setNavView(settings.navView === '3d');
const sheet = initSheet($('#sheet'));
setInterval(applyTheme, 60000);

function setView(name) {
  state.view = name;
  showView(name);
  sheet.expand();
}

const syncOnline = () => {
  $('#offline').hidden = navigator.onLine;
  if (navigator.onLine) map.retryStyle();
};
addEventListener('online', syncOnline);
addEventListener('offline', syncOnline);
syncOnline();

// ── Position ────────────────────────────────────────────────
let lastErr = { kind: null, at: 0 };

async function startLocation(background) {
  state.locError = null;
  try {
    await native.watchLocation(background, onFix, onLocError);
  } catch {
    onLocError('unavailable');
  }
}

function onLocError(kind) {
  if (kind === 'unavailable' && state.fix && Date.now() - state.fix.time < 15000) return; // raté ponctuel, le GPS répond
  state.locError = kind;
  if (kind === lastErr.kind && Date.now() - lastErr.at < 30000) return; // pas de messages en rafale
  lastErr = { kind, at: Date.now() };
  if (kind === 'denied')
    toast('Accès à la position refusé. Autorisez-le pour vous situer et être guidé.', {
      action: native.isNative ? 'Réglages' : '',
      onAction: native.openAppSettings,
      duration: 9000,
    });
  else if (kind === 'disabled') toast('La localisation du téléphone est désactivée. Activez-la dans les réglages rapides.', { duration: 9000 });
  else toast('Signal GPS introuvable pour le moment. Placez-vous à découvert.', { duration: 6000 });
}

async function initLocation() {
  const perm = await native.locationPermission();
  if (perm === 'granted') return startLocation(false);
  if (perm === 'denied') return onLocError('denied');
  const ok = await ask({
    title: 'Activer la localisation',
    text: 'Vanguard Navigator utilise votre position pour vous situer sur la carte, trouver les lieux proches et vous guider. Elle n’est transmise qu’aux services de recherche et d’itinéraire.',
    ok: 'Autoriser',
    cancel: 'Plus tard',
  });
  if (ok) startLocation(false);
}

let lastPosSave = 0;
function onFix(fix) {
  const prev = state.fix;
  if (fix.speed == null && prev) {
    const dt = (fix.time - prev.time) / 1000;
    if (dt > 0 && dt < 10) fix.speed = haversine([prev.lon, prev.lat], [fix.lon, fix.lat]) / dt;
  }
  if (!Number.isFinite(fix.heading)) fix.heading = null;
  state.fix = fix;
  state.locError = null;
  if (Date.now() - lastPosSave > 60000) {
    lastPosSave = Date.now();
    places.lastPos = { lon: fix.lon, lat: fix.lat };
    savePlaces();
  }
  if (!prev) applyTheme();
  if (state.nav) return navFix(fix);

  map.updateUser([fix.lon, fix.lat], fix.speed > 1.5 ? fix.heading : null, fix.speed);
  if (!prev && state.view === 'home') map.recenter();
  if (state.pendingRoute) {
    state.pendingRoute = false;
    computeRoutes();
  }
}

map.on('follow', (following) => {
  $('#btn-recenter').hidden = following || !state.nav;
  $('#btn-locate').classList.toggle('following', following);
});
$('#btn-locate').onclick = () => {
  if (state.locError || !map.hasPosition()) return state.locError ? initLocation() : toast('Recherche du signal GPS…');
  map.recenter();
};
$('#btn-recenter').onclick = () => map.recenter();

// ── Recherche ───────────────────────────────────────────────
const input = $('#search-input'), results = $('#search-results');
let searchCtrl = null, searchTimer = 0;
const FAVS = { home: ['Domicile', 'i-home'], work: ['Travail', 'i-work'] };

function openSearch(mode = 'dest') {
  state.searchMode = mode;
  const title = {
    origin: 'Choisir le point de départ',
    home: 'Définir l’adresse du domicile',
    work: 'Définir l’adresse du travail',
    dest: state.nextFrom ? `Départ : ${state.nextFrom.name} — choisissez la destination` : '',
  }[mode];
  setText($('#search-mode'), title);
  $('#search-mode').hidden = !title;
  input.value = '';
  $('#search-clear').hidden = true;
  $('#search').hidden = false;
  renderSuggestions();
  setTimeout(() => input.focus(), 60);
}
function closeSearch() {
  $('#search').hidden = true;
  input.blur();
  searchCtrl?.abort();
  clearTimeout(searchTimer);
}

function item({ icon, accent, title, sub, place, onClick, onEdit }) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'item';
  b.innerHTML = `<span class="ic${accent ? ' accent' : ''}"><svg><use href="#${icon}"/></svg></span><span class="grow"><div class="t ellipsis"></div><div class="s ellipsis"></div></span><span class="d"></span>`;
  b.querySelector('.t').textContent = title; // textContent : les données distantes ne sont jamais interprétées en HTML
  b.querySelector('.s').textContent = sub || '';
  if (place && state.fix) b.querySelector('.d').textContent = fmtDistance(haversine([state.fix.lon, state.fix.lat], [place.lon, place.lat]), settings.units);
  b.onclick = onClick;
  li.append(b);
  if (onEdit) {
    const e = document.createElement('button');
    e.type = 'button';
    e.className = 'icon-btn';
    e.setAttribute('aria-label', `Modifier ${title}`);
    e.innerHTML = '<svg><use href="#i-edit"/></svg>';
    e.onclick = onEdit;
    li.append(e);
  }
  return li;
}
const row = (cls, text) => Object.assign(document.createElement('li'), { className: cls, textContent: text });

function renderSuggestions() {
  const mode = state.searchMode, out = [];
  if (mode === 'origin') out.push(item({ icon: 'i-locate', accent: true, title: 'Ma position', onClick: () => pick('me') }));
  if (mode === 'dest' || mode === 'origin') {
    for (const [k, [label, icon]] of Object.entries(FAVS)) {
      const p = places[k];
      out.push(item({ icon, accent: true, title: label, sub: p ? p.name : 'Touchez pour définir', place: p, onClick: () => (p ? pick(p) : openSearch(k)), onEdit: p && (() => openSearch(k)) }));
    }
  }
  if (places.recents.length) {
    out.push(row('sep', 'Récents'));
    for (const p of places.recents) out.push(item({ icon: 'i-clock', title: p.name, sub: p.address, place: p, onClick: () => pick(p) }));
  } else if (mode === 'home' || mode === 'work') out.push(row('empty', 'Tapez une adresse.'));
  results.replaceChildren(...out);
}

input.addEventListener('input', () => {
  $('#search-clear').hidden = !input.value;
  clearTimeout(searchTimer);
  searchCtrl?.abort();
  const q = input.value.trim();
  if (q.length < 2) return renderSuggestions();
  searchTimer = setTimeout(() => runSearch(q), CONFIG.search.debounceMs);
});
input.addEventListener('keydown', (e) => e.key === 'Enter' && input.blur());
$('#search-clear').onclick = () => {
  input.value = '';
  input.dispatchEvent(new Event('input'));
  input.focus();
};
$('#search-back').onclick = () => {
  state.nextFrom = null;
  closeSearch();
};

async function runSearch(q) {
  const ctrl = (searchCtrl = new AbortController());
  const spin = document.createElement('li');
  spin.className = 'empty';
  spin.innerHTML = '<div class="spinner"></div>';
  results.replaceChildren(spin);
  try {
    const found = await searchPlaces(q, state.fix, ctrl.signal);
    if (ctrl !== searchCtrl) return;
    results.replaceChildren(
      ...(found.length
        ? found.map((p) => item({ icon: 'i-pin', title: p.name, sub: p.address, place: p, onClick: () => pick(p) }))
        : [row('empty', `Aucun résultat pour « ${q} ». Vérifiez l’orthographe ou ajoutez la ville.`)])
    );
  } catch (e) {
    if (e.kind !== 'cancel' && ctrl === searchCtrl) results.replaceChildren(row('empty', errText(e)));
  }
}

function pick(place) {
  const mode = state.searchMode;
  closeSearch();
  if (mode === 'home' || mode === 'work') {
    places[mode] = place;
    savePlaces();
    return toast(`${FAVS[mode][0]} enregistré : ${place.name}`);
  }
  if (mode === 'origin') {
    state.trip.from = place === 'me' ? null : place;
    return computeRoutes();
  }
  addRecent(place);
  planTrip(place);
}

$('#search-open').onclick = () => openSearch('dest');
for (const chip of document.querySelectorAll('[data-fav]')) {
  chip.onclick = () => (places[chip.dataset.fav] ? planTrip(places[chip.dataset.fav]) : openSearch(chip.dataset.fav));
}

// ── Lieu choisi sur la carte (appui long) ───────────────────
map.on('longpress', async (lngLat) => {
  if (state.nav) return;
  const tmp = { name: 'Point sélectionné', address: 'Recherche de l’adresse…', lon: lngLat.lng, lat: lngLat.lat };
  showPlace(tmp);
  const p = await reverseGeocode(lngLat.lng, lngLat.lat);
  if (state.place === tmp && state.view === 'place') showPlace(p);
});
function showPlace(p) {
  state.place = p;
  clearTrip();
  map.setDestination(p);
  setText($('#place-name'), p.name);
  setText($('#place-addr'), p.address);
  setView('place');
}
$('#place-go').onclick = () => planTrip(state.place);
$('#place-from').onclick = () => {
  state.nextFrom = state.place;
  map.setDestination(null);
  openSearch('dest');
};

// ── Itinéraires ─────────────────────────────────────────────
let routeCtrl = null;

function planTrip(to) {
  state.trip = { from: state.nextFrom, to, routes: [], active: 0 };
  state.nextFrom = null;
  computeRoutes();
}

function clearTrip() {
  routeCtrl?.abort();
  state.trip = null;
  state.pendingRoute = false;
  map.setRoutes([]);
  map.setRadars([]);
  map.setOrigin(null);
  map.setDestination(null);
}

function goHome() {
  clearTrip();
  state.place = null;
  setView('home');
}
for (const b of document.querySelectorAll('[data-close]')) b.onclick = goHome;

async function computeRoutes() {
  const trip = state.trip;
  if (!trip) return;
  setView('routes');
  setText($('#od-from-label'), trip.from ? trip.from.name : 'Ma position');
  setText($('#od-to-label'), trip.to.name);
  map.setDestination(trip.to);
  map.setOrigin(trip.from);
  const from = trip.from || state.fix;
  if (!from) {
    state.pendingRoute = true;
    return renderRouteState(state.locError ? 'Position indisponible : choisissez un point de départ.' : 'En attente du signal GPS…', !state.locError);
  }
  renderRouteState('Calcul de l’itinéraire…', true);
  routeCtrl?.abort();
  const ctrl = (routeCtrl = new AbortController());
  try {
    const routes = await fetchRoutes({ lon: from.lon, lat: from.lat }, trip.to, { ...routeOpts(), signal: ctrl.signal });
    if (ctrl !== routeCtrl || state.trip !== trip) return;
    trip.routes = routes;
    trip.active = 0;
    map.setRoutes(routes, 0);
    renderRoutes();
    map.fitRoutes(routes, sheet.height());
    if (settings.radars)
      loadRadars(routes)
        .then(() => state.trip === trip && !state.nav && (renderRoutes(), map.setRadars(trip.routes[trip.active].radars)))
        .catch((e) => console.warn('Radars indisponibles', e)); // l'aperçu reste utilisable
  } catch (e) {
    if (e.kind === 'cancel' || state.trip !== trip) return;
    trip.routes = [];
    map.setRoutes([]);
    renderRouteState(errText(e), false, true);
  }
}

function renderRouteState(message, loading, retry = false) {
  for (const id of ['#r-dist', '#r-eta']) setText($(id), '');
  setText($('#r-time'), '–');
  $('#btn-start').disabled = true;
  const box = document.createElement('div');
  box.className = 'state';
  if (loading) box.append(Object.assign(document.createElement('div'), { className: 'spinner' }));
  box.append(Object.assign(document.createElement('div'), { textContent: message }));
  if (retry) box.append(Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'Réessayer', onclick: computeRoutes }));
  $('#route-list').replaceChildren(box);
}

const tags = (r) => [r.hasToll && 'Péages', r.hasFerry && 'Ferry', r.radars?.length && `${r.radars.length} radar${r.radars.length > 1 ? 's' : ''}`].filter(Boolean);
const eta = (sec) => fmtClock(new Date(Date.now() + sec * 1000));

function renderRoutes() {
  const { routes, active } = state.trip, r = routes[active];
  setText($('#r-time'), fmtDuration(r.time));
  setText($('#r-dist'), fmtDistance(r.length, settings.units));
  setText($('#r-eta'), [`Arrivée vers ${eta(r.time)}`, ...tags(r)].join(' · '));
  $('#btn-start').disabled = false;
  const cards = routes.length < 2 ? [] : routes.map((rt, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `route${i === active ? ' active' : ''}`;
    b.innerHTML = '<div><b></b><div class="muted"></div></div><div class="tags"></div>';
    b.querySelector('b').textContent = fmtDuration(rt.time);
    b.querySelector('.muted').textContent = `${fmtDistance(rt.length, settings.units)} · ${eta(rt.time)}`;
    b.querySelector('.tags').append(...tags(rt).map((t) => Object.assign(document.createElement('span'), { className: 'tag', textContent: t })));
    b.onclick = () => selectRoute(i);
    return b;
  });
  $('#route-list').replaceChildren(...cards);
}

function selectRoute(i) {
  if (!state.trip?.routes[i]) return;
  state.trip.active = i;
  map.setRoutes(state.trip.routes, i);
  map.setRadars(state.trip.routes[i].radars);
  renderRoutes();
}
map.on('routetap', (i) => !state.nav && selectRoute(i));
$('#od-from').onclick = () => openSearch('origin');

for (const chip of document.querySelectorAll('[data-avoid]')) {
  chip.onclick = () => {
    settings[chip.dataset.avoid] = !settings[chip.dataset.avoid];
    saveSettings();
    syncControls();
    computeRoutes();
  };
}

// ── Navigation guidée ───────────────────────────────────────
$('#btn-start').onclick = startNavigation;
$('#btn-stop').onclick = () => finishNavigation(false);

async function startNavigation() {
  const trip = state.trip;
  if (!trip?.routes.length) return;
  if (!state.fix) return toast('En attente du signal GPS…');
  if (trip.from) {
    // Départ choisi ≠ position réelle : on guide depuis là où l'on est vraiment.
    trip.from = null;
    await computeRoutes();
    if (state.trip !== trip || !trip.routes.length) return;
  }
  if (native.isNative && !settings.backgroundExplained) {
    await ask({
      title: 'Guidage écran verrouillé',
      text: 'Pendant le trajet, une notification « Navigation en cours » s’affiche : Vanguard continue de vous guider écran éteint ou application en arrière-plan.',
      ok: 'Continuer',
      icon: 'i-nav',
    });
    settings.backgroundExplained = true;
    saveSettings();
  }
  await native.ensureNotificationPermission();

  const route = trip.routes[trip.active];
  state.nav = { guidance: new Guidance(route, { units: settings.units }), dest: trip.to, rerouting: false, lastReroute: 0 };
  map.setRoutes([route], 0);
  map.setOrigin(null);
  if (settings.radars && !route.radars) refreshRadars(route); // l'aperçu n'a pas pu les charger
  document.body.classList.add('navigating');
  $('#sheet').classList.add('hidden-down');
  $('.top-right').hidden = true;
  $('#nav').hidden = false;
  hideToast();
  syncMute();
  native.keepAwake(true);
  map.setNavMode(true);
  navFix(state.fix);
  startLocation(true);
}

function navFix(fix) {
  const nav = state.nav;
  const st = nav.guidance.update(fix);
  const gpsHeading = fix.speed > 1.5 ? fix.heading : null;
  map.updateUser(st.onRoute ? st.snapped : [fix.lon, fix.lat], st.onRoute ? st.heading : gpsHeading, fix.speed);
  renderNav(st, fix);
  if (st.speech) native.speak(st.speech);
  if (st.arrived) return finishNavigation(true);
  if (st.offRoute) reroute(fix);
}

/** Radars de l'itinéraire suivi (démarrage, recalcul) : en arrière-plan, sans bloquer le guidage. */
async function refreshRadars(route) {
  const nav = state.nav;
  try {
    await loadRadars([route]);
    if (state.nav === nav && nav?.guidance.route === route) map.setRadars(route.radars);
  } catch {
    if (state.nav === nav) toast('Radars indisponibles pour ce trajet (réseau).');
  }
}

function renderNav(st, fix) {
  const nav = state.nav;
  const radar = $('#nav-radar');
  radar.hidden = !st.radar;
  if (st.radar) {
    setText($('#radar-dist'), fmtDistance(st.radar.distance, settings.units));
    $('#radar-limit').hidden = !st.radar.maxspeed;
    setText($('#radar-limit'), String(st.radar.maxspeed || ''));
  }
  const kmh = (fix.speed || 0) * 3.6;
  $('#nav-speed').classList.toggle('over', !!st.radar?.maxspeed && kmh > st.radar.maxspeed + 2);
  if (!nav.rerouting) {
    const { id, flip } = maneuverIcon(st.maneuver.type);
    const arrow = $('#nav-arrow'), use = arrow.firstElementChild;
    if (use.getAttribute('href') !== `#${id}`) use.setAttribute('href', `#${id}`);
    arrow.classList.toggle('flip', flip);
    setText($('#nav-dist'), fmtDistance(st.distToNext, settings.units));
    setText($('#nav-street'), isDest(st.maneuver) ? nav.dest.name : st.maneuver.street || st.maneuver.text);
  }
  setText($('#nav-eta'), eta(st.remainingTime));
  setText($('#nav-remaining'), `${fmtDuration(st.remainingTime)} · ${fmtDistance(st.remainingDist, settings.units)}`);
  setText($('#nav-speed b'), String(fmtSpeed(fix.speed, settings.units)));
  setText($('#nav-speed small'), speedUnit(settings.units));
}

async function reroute(fix) {
  const nav = state.nav;
  if (nav.rerouting || Date.now() - nav.lastReroute < CONFIG.nav.rerouteCooldownMs) return;
  nav.rerouting = true;
  nav.lastReroute = Date.now();
  $('#nav-banner').classList.add('rerouting');
  setText($('#nav-dist'), 'Recalcul…');
  setText($('#nav-street'), 'Vous avez quitté l’itinéraire');
  try {
    const heading = fix.speed > 2 ? fix.heading : null;
    const [route] = await fetchRoutes({ lon: fix.lon, lat: fix.lat, heading }, nav.dest, { ...routeOpts(), alternates: 0 });
    if (state.nav !== nav) return;
    nav.guidance.setRoute(route, true);
    map.setRoutes([route], 0);
    map.setRadars([]);
    if (settings.radars) refreshRadars(route);
    native.speak('Itinéraire recalculé.');
  } catch (e) {
    if (state.nav === nav) toast(e.kind === 'offline' ? 'Hors itinéraire et sans connexion. Nouvel essai dans quelques secondes.' : errText(e));
  } finally {
    nav.rerouting = false;
    $('#nav-banner').classList.remove('rerouting');
  }
}

function finishNavigation(arrived) {
  const nav = state.nav;
  if (!nav) return;
  state.nav = null;
  if (!arrived) native.stopSpeaking(); // à l'arrivée, on laisse finir « Vous êtes arrivé »
  document.body.classList.remove('navigating');
  $('#nav').hidden = true;
  $('#sheet').classList.remove('hidden-down');
  $('.top-right').hidden = false;
  native.keepAwake(false);
  map.setNavMode(false);
  startLocation(false); // fin du service de premier plan et de sa notification
  clearTrip();
  if (arrived) {
    map.setDestination(nav.dest);
    setText($('#arrived-name'), nav.dest.name);
    setView('arrived');
  } else setView('home');
}

function syncMute() {
  const b = $('#btn-mute');
  b.classList.toggle('muted-on', !settings.voice);
  b.firstElementChild.firstElementChild.setAttribute('href', settings.voice ? '#i-sound' : '#i-mute');
  b.setAttribute('aria-label', settings.voice ? 'Couper le guidage vocal' : 'Réactiver le guidage vocal');
}
function syncView() {
  map.setNavView(settings.navView === '3d');
  setText($('#btn-view'), settings.navView === '3d' ? '2D' : '3D'); // le bouton propose l'autre vue
}
$('#btn-view').onclick = () => {
  settings.navView = settings.navView === '3d' ? '2d' : '3d';
  onSettingChanged('navView');
};
$('#btn-layers').onclick = () => {
  settings.mapType = settings.mapType === 'satellite' ? 'plan' : 'satellite';
  onSettingChanged('mapType');
  toast(settings.mapType === 'satellite' ? 'Vue satellite' : 'Vue plan', { duration: 1500 });
};

$('#btn-mute').onclick = () => {
  settings.voice = !settings.voice;
  saveSettings();
  if (!settings.voice) native.stopSpeaking();
  syncMute();
  syncControls();
};

// ── Réglages ────────────────────────────────────────────────
function syncControls() {
  for (const seg of document.querySelectorAll('.seg'))
    for (const b of seg.children) b.classList.toggle('on', settings[seg.dataset.setting] === b.dataset.value);
  for (const inp of document.querySelectorAll('input[data-setting]')) inp.checked = !!settings[inp.dataset.setting];
  for (const chip of document.querySelectorAll('[data-avoid]')) chip.classList.toggle('on', !!settings[chip.dataset.avoid]);
}

function onSettingChanged(key) {
  saveSettings();
  syncControls();
  syncMute();
  if (key === 'theme') applyTheme();
  if (key === 'mapType') map.setMapStyle({ satellite: settings.mapType === 'satellite' });
  if (key === 'navView') syncView();
  if (key === 'radars') {
    const route = state.nav ? state.nav.guidance.route : state.trip?.routes[state.trip.active];
    if (!settings.radars) {
      for (const r of [route, ...(state.trip?.routes || [])]) if (r) r.radars = [];
      map.setRadars([]);
    } else if (route) state.nav ? refreshRadars(route) : computeRoutes();
  }
  if (key === 'units' && state.trip?.routes.length) renderRoutes();
  if (key === 'units' && state.nav) state.nav.guidance.units = settings.units;
  if (key.startsWith('avoid') && state.trip && !state.nav) computeRoutes();
}

for (const seg of document.querySelectorAll('.seg')) {
  seg.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    settings[seg.dataset.setting] = b.dataset.value;
    onSettingChanged(seg.dataset.setting);
  };
}
for (const inp of document.querySelectorAll('input[data-setting]')) {
  inp.onchange = () => {
    settings[inp.dataset.setting] = inp.checked;
    onSettingChanged(inp.dataset.setting);
  };
}

async function fillVoices() {
  const sel = $('#voice-select');
  const voices = await native.listVoices();
  sel.replaceChildren(new Option('Par défaut', ''), ...voices.map((v) => new Option(v.name, v.uri)));
  sel.value = voices.some((v) => v.uri === settings.voiceURI) ? settings.voiceURI : '';
}
$('#voice-select').onchange = (e) => {
  settings.voiceURI = e.target.value;
  saveSettings();
};
$('#voice-test').onclick = () => native.speak('Dans 300 mètres, tournez à droite.', true);
$('#btn-settings').onclick = () => {
  syncControls();
  fillVoices();
  $('#settings').hidden = false;
};
const closeSettings = () => ($('#settings').hidden = true);
$('#settings-back').onclick = closeSettings;

// ── Bouton retour Android et retour au premier plan ─────────
native.onBackButton(() => {
  if (closeDialog()) return;
  if (!$('#search').hidden) return $('#search-back').click();
  if (!$('#settings').hidden) return closeSettings();
  if (state.nav) return native.minimizeApp(); // la navigation continue en arrière-plan
  if (state.view !== 'home') return goHome();
  native.exitApp();
});
native.onResume(() => {
  applyTheme();
  if (state.locError) startLocation(!!state.nav); // l'utilisateur vient peut-être d'autoriser la position
});

syncControls();
syncView();
initLocation();
