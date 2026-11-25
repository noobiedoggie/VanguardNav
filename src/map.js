// Carte MapLibre : style jour/nuit, itinéraires, marqueurs, caméra de navigation.
// À chaque fix GPS on ne bouge que le marqueur et la caméra : aucune couche n'est recréée.
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { CONFIG, OSM_RASTER_STYLE } from './config.js';
import { haversine } from './geo.js';
import { nightStyle, satelliteStyle, finishStyle } from './styles.js';

const ACCENT = '#1F6FFF', ACCENT_DARK = '#0B3FB3';
const EMPTY = { type: 'FeatureCollection', features: [] };

let map, me, meEl, destMarker, originMarker;
let look = { night: false, satellite: false }, styleReady = false, fallback = false;
let routesFC = EMPTY, radarsFC = EMPTY;
let raf = 0;
const cam = { follow: false, nav: false, from: null, to: null, bFrom: 0, bTo: 0, t0: 0, dur: 1, lastFix: 0, hasHeading: false, zoom: 17, pitch: 50 };
const handlers = { follow() {}, longpress() {}, routetap() {} };

export const on = (event, fn) => (handlers[event] = fn);
export const getMap = () => map;

export function initMap(container, { center, zoom, ...mapLook }) {
  map = new maplibregl.Map({
    container,
    center,
    zoom,
    attributionControl: false,
    maxPitch: 70,
    fadeDuration: 100,
    canvasContextAttributes: { antialias: true }, // lignes nettes en vue inclinée
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'top-left');

  map.on('style.load', () => {
    styleReady = true;
    addOverlayLayers();
    showPois(!cam.nav);
  });
  // Style injoignable (serveur en panne, hors-ligne) : repli sur les tuiles raster OSM.
  map.on('error', (e) => {
    if (styleReady || e.sourceId || fallback) return;
    console.warn('Style de carte indisponible, repli', e.error);
    fallback = true;
    map.setStyle(OSM_RASTER_STYLE, { diff: false });
  });
  setMapStyle(mapLook, true);

  // Un geste de l'utilisateur détache la caméra (bouton « Recentrer »).
  for (const ev of ['dragstart', 'rotatestart', 'pitchstart', 'zoomstart']) {
    map.on(ev, (e) => {
      if (!e.originalEvent || (!cam.nav && ev === 'zoomstart')) return; // zoom libre : on garde le suivi
      cam.gesture = true;
      setFollow(false);
    });
  }
  map.on('click', (e) => {
    if (!map.getLayer('route-alt')) return;
    const { x, y } = e.point;
    const f = map.queryRenderedFeatures([[x - 14, y - 14], [x + 14, y + 14]], { layers: ['route-alt'] })[0];
    if (f) handlers.routetap(f.properties.i);
  });
  bindLongPress();
  addEventListener('resize', () => cam.nav && map.setPadding(navPadding()));
  return map;
}

/** { night, satellite } : plan jour, plan nuit ou satellite, tous dérivés du même style. */
export function setMapStyle({ night = look.night, satellite = look.satellite }, force = false) {
  if (!force && !fallback && night === look.night && satellite === look.satellite) return;
  look = { night, satellite };
  styleReady = false;
  fallback = false;
  map.setStyle(CONFIG.map.style, {
    diff: false,
    transformStyle: (_, next) => finishStyle(satellite ? satelliteStyle(next) : night ? nightStyle(next) : next, night && !satellite),
  });
}
/** Après un retour du réseau : retente le style vectoriel si on est sur le secours raster. */
export const retryStyle = () => fallback && setMapStyle(look, true);

// Icône radar dessinée une fois (canvas → pixels), réutilisable à chaque changement de style.
function radarImage() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.beginPath(); g.arc(32, 32, 29, 0, 2 * Math.PI);
  g.fillStyle = '#fff'; g.fill();
  g.lineWidth = 6; g.strokeStyle = '#E5242B'; g.stroke();
  g.translate(14, 14); g.scale(1.5, 1.5);
  g.fillStyle = '#111';
  g.fill(new Path2D('M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z'));
  g.fillStyle = '#fff';
  g.fill(new Path2D('M12 9.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7z'));
  return g.getImageData(0, 0, 64, 64);
}

function addOverlayLayers() {
  if (map.getSource('routes')) return;
  if (!map.hasImage('radar')) map.addImage('radar', radarImage(), { pixelRatio: 2 });
  map.addSource('radars', { type: 'geojson', data: radarsFC });
  map.addLayer({ id: 'radars', type: 'symbol', source: 'radars', layout: { 'icon-image': 'radar', 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  // Au-dessus des routes, ponts et bâtiments 3D, mais sous les libellés finaux.
  const layers = map.getStyle().layers;
  const before = layers.slice(layers.findLastIndex((l) => l.type !== 'symbol') + 1).find((l) => l.type === 'symbol')?.id;
  const width = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 17, b];
  const layout = { 'line-join': 'round', 'line-cap': 'round' };
  map.addSource('routes', { type: 'geojson', data: routesFC });
  map.addLayer({ id: 'route-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'active'], false], layout,
    paint: { 'line-color': look.night ? '#4B5468' : '#A3ACBE', 'line-width': width(4, 10) } }, before);
  map.addLayer({ id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'active'], true], layout,
    paint: { 'line-color': ACCENT_DARK, 'line-width': width(7, 17) } }, before);
  map.addLayer({ id: 'route-line', type: 'line', source: 'routes', filter: ['==', ['get', 'active'], true], layout,
    paint: { 'line-color': ACCENT, 'line-width': width(4.5, 12) } }, before);
}

export function setRoutes(routes, active = 0) {
  routesFC = {
    type: 'FeatureCollection',
    features: routes.map((r, i) => ({ type: 'Feature', properties: { i, active: i === active }, geometry: { type: 'LineString', coordinates: r.coords } })),
  };
  map.getSource('routes')?.setData(routesFC);
}

/** Radars à afficher : [{ lon, lat }]. */
export function setRadars(list = []) {
  radarsFC = { type: 'FeatureCollection', features: list.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } })) };
  map.getSource('radars')?.setData(radarsFC);
}

export function fitRoutes(routes, bottomPx) {
  const b = new maplibregl.LngLatBounds();
  routes.forEach((r) => r.coords.forEach((c) => b.extend(c)));
  if (!routes.length) return;
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const land = w > h && w >= 640;
  const padding = land
    ? { top: 60, bottom: 60, left: Math.min(440, w * 0.5), right: 60 }
    : { top: 70, bottom: Math.min(bottomPx + 30, h - 160), left: 40, right: 40 };
  map.fitBounds(b, { padding, maxZoom: 16, duration: 700, bearing: 0, pitch: 0 });
}

function markerEl(cls, svg) {
  const el = document.createElement('div');
  el.className = cls;
  el.innerHTML = svg;
  return el;
}
const PIN = '<svg viewBox="0 0 24 24"><path d="M12 22s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12z"/><circle cx="12" cy="10" r="2.6"/></svg>';

export function setDestination(p) {
  destMarker?.remove();
  destMarker = p ? new maplibregl.Marker({ element: markerEl('pin', PIN), anchor: 'bottom' }).setLngLat([p.lon, p.lat]).addTo(map) : null;
}
export function setOrigin(p) {
  originMarker?.remove();
  originMarker = p ? new maplibregl.Marker({ element: markerEl('origin', '') }).setLngLat([p.lon, p.lat]).addTo(map) : null;
}

// ── Position de l'utilisateur et caméra ─────────────────────
const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => (a + ((((b - a) % 360) + 540) % 360 - 180) * t + 360) % 360;
const progress = (now) => Math.min(1, (now - cam.t0) / cam.dur);
const posAt = (t) => [lerp(cam.from[0], cam.to[0], t), lerp(cam.from[1], cam.to[1], t)];

/** pos [lon, lat] ; heading en degrés ou null ; speed en m/s (zoom adapté à la vitesse). */
export function updateUser(pos, heading, speed = 0) {
  const now = performance.now();
  if (!me) {
    meEl = markerEl('me', '<div class="me-halo"></div><svg class="me-arrow" viewBox="0 0 24 24"><path d="M12 2.5 19.5 21 12 16.8 4.5 21z"/></svg><div class="me-dot"></div>');
    me = new maplibregl.Marker({ element: meEl, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat(pos).addTo(map);
  }
  const t = cam.to ? progress(now) : 1;
  const cur = cam.to ? posAt(t) : pos;
  const curB = lerpAngle(cam.bFrom, cam.bTo, t);
  cam.from = haversine(cur, pos) > 1000 ? pos : cur; // grand saut : pas d'animation
  cam.to = pos;
  cam.bFrom = curB;
  cam.bTo = heading ?? curB;
  if (heading != null && !cam.hasHeading) meEl.classList.add('has-heading');
  cam.hasHeading ||= heading != null;
  cam.zoom = speed > 25 ? 15.6 : speed > 14 ? 16.5 : 17.3;
  cam.dur = Math.min(1500, Math.max(300, now - cam.lastFix)); // interpolation calée sur la cadence GPS
  cam.lastFix = now;
  cam.t0 = now;
  if (!raf) raf = requestAnimationFrame(tick);
}

function tick(now) {
  raf = 0;
  const t = progress(now);
  const p = posAt(t), b = lerpAngle(cam.bFrom, cam.bTo, t);
  me.setLngLat(p).setRotation(b);
  let settling = false;
  if (cam.follow) {
    const o = { center: p };
    if (cam.nav) {
      const z = map.getZoom(), pitch = map.getPitch();
      o.bearing = b;
      o.zoom = z + (cam.zoom - z) * 0.05;
      o.pitch = pitch + (cam.pitch - pitch) * 0.08;
      settling = Math.abs(cam.zoom - z) > 0.01 || Math.abs(cam.pitch - pitch) > 0.2;
    }
    map.jumpTo(o);
  }
  if (t < 1 || settling) raf = requestAnimationFrame(tick);
}

function setFollow(v) {
  if (cam.follow === v) return;
  cam.follow = v;
  handlers.follow(v);
  if (v && !raf && cam.to) raf = requestAnimationFrame(tick);
}
export const isFollowing = () => cam.follow;
export const hasPosition = () => !!cam.to;

/** Recentre en douceur sur l'utilisateur, puis la caméra le suit. */
export function recenter() {
  if (!cam.to) return false;
  const o = { center: cam.to, duration: 800 };
  if (cam.nav) Object.assign(o, { bearing: cam.bTo, pitch: cam.pitch, zoom: cam.zoom, padding: navPadding() });
  else o.zoom = Math.max(map.getZoom(), 15.5);
  cam.gesture = false;
  map.easeTo(o);
  map.once('moveend', () => !cam.gesture && setFollow(true));
  return true;
}

function navPadding() {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  return w > h && w >= 640
    ? { top: h * 0.3, bottom: 0, left: Math.min(420, w * 0.45), right: 0 } // paysage : panneau à gauche
    : { top: h * 0.42, bottom: 0, left: 0, right: 0 }; // portrait : position dans le tiers bas
}

// En conduite, on masque les points d'intérêt : la carte ne garde que routes et noms de rues.
function showPois(v) {
  for (const l of map.getStyle()?.layers || []) if (/^poi/.test(l.id)) map.setLayoutProperty(l.id, 'visibility', v ? 'visible' : 'none');
}

/** Vue de navigation : 3D inclinée ou 2D à plat (toujours orientée dans le sens de la marche). */
export function setNavView(is3d) {
  cam.pitch = is3d ? 50 : 0;
  if (cam.follow && !raf && cam.to) raf = requestAnimationFrame(tick);
}

export function setNavMode(v) {
  cam.nav = v;
  if (styleReady) showPois(!v);
  setFollow(false);
  if (v) recenter();
  else map.easeTo({ pitch: 0, bearing: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 600 });
}

export function flyTo(lon, lat, zoom = 15) {
  setFollow(false);
  map.easeTo({ center: [lon, lat], zoom, duration: 700 });
}

export function bindCompass(btn) {
  const update = () => {
    btn.hidden = cam.nav || (Math.abs(map.getBearing()) < 1 && map.getPitch() < 1);
    btn.firstElementChild.style.transform = `rotate(${-map.getBearing()}deg)`;
  };
  map.on('rotate', update);
  map.on('pitch', update);
  btn.addEventListener('click', () => map.easeTo({ bearing: 0, pitch: 0, duration: 500 }));
}

function bindLongPress() {
  let lp = null, last = 0;
  const cancel = () => (clearTimeout(lp?.timer), (lp = null));
  const fire = (lngLat) => {
    if (Date.now() - last < 800) return; // Chrome Android émet aussi « contextmenu »
    last = Date.now();
    handlers.longpress(lngLat);
  };
  map.on('touchstart', (e) => {
    cancel();
    if (e.originalEvent.touches.length === 1) lp = { point: e.point, timer: setTimeout(() => fire(e.lngLat), 550) };
  });
  map.on('touchmove', (e) => lp && Math.hypot(e.point.x - lp.point.x, e.point.y - lp.point.y) > 8 && cancel());
  map.on('touchend', cancel);
  map.on('touchcancel', cancel);
  map.on('contextmenu', (e) => fire(e.lngLat));
}
