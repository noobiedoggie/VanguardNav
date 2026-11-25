// Transports en commun dans le monde entier via Transitous (API MOTIS, gratuite, sans clé) :
// itinéraires bus/train/métro/tram/ferry, véhicules en circulation, arrêts et prochains départs.
import { CONFIG } from './config.js';
import { decodePolyline, cumulative } from './geo.js';
import { AppError, fetchJson } from './routing.js';

const MODES = {
  BUS: ['Bus', 'i-bus', '#0E9F6E'],
  COACH: ['Car', 'i-bus', '#0E9F6E'],
  TRAM: ['Tram', 'i-tram', '#D6246E'],
  SUBWAY: ['Métro', 'i-train', '#7B3FE4'],
  METRO: ['RER', 'i-train', '#7B3FE4'],
  SUBURBAN: ['RER', 'i-train', '#7B3FE4'],
  RAIL: ['Train', 'i-train', '#E0592A'],
  REGIONAL_RAIL: ['Train', 'i-train', '#E0592A'],
  REGIONAL_FAST_RAIL: ['Train', 'i-train', '#E0592A'],
  HIGHSPEED_RAIL: ['Train grande vitesse', 'i-train', '#C2410C'],
  LONG_DISTANCE: ['Grandes lignes', 'i-train', '#C2410C'],
  NIGHT_RAIL: ['Train de nuit', 'i-train', '#4338CA'],
  FERRY: ['Ferry', 'm-ferry', '#0891B2'],
  AIRPLANE: ['Avion', 'i-nav', '#64748B'],
  FUNICULAR: ['Funiculaire', 'i-tram', '#D6246E'],
  AERIAL_LIFT: ['Téléphérique', 'i-tram', '#D6246E'],
  AREAL_LIFT: ['Téléphérique', 'i-tram', '#D6246E'],
  CABLE_CAR: ['Téléphérique', 'i-tram', '#D6246E'],
  WALK: ['À pied', 'i-walk', '#8A93A6'],
};
/** Mode MOTIS → { label, icon, color } (couleur par défaut si la ligne n'en a pas). */
export const modeInfo = (mode) => {
  const [label, icon, color] = MODES[mode] || ['Transport', 'i-bus', '#475569'];
  return { label, icon, color };
};
const lineColor = (hex, mode) => (/^[0-9a-f]{6}$/i.test(hex || '') ? `#${hex}` : modeInfo(mode).color);
const latlon = (p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
const api = (path, params) => {
  const url = new URL(path, CONFIG.transit.url);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  return url;
};

async function get(path, params, opts = {}) {
  const { ok, json } = await fetchJson(api(path, params), { timeoutMs: 30000, ...opts });
  if (!ok || !json) throw new AppError('server', json?.error);
  return json;
}

// ── Itinéraires ─────────────────────────────────────────────
export function parseItinerary(it) {
  const legs = it.legs.map((l) => ({
    mode: l.mode,
    name: l.displayName || l.routeShortName || '',
    headsign: l.headsign || '',
    color: lineColor(l.routeColor, l.mode),
    textColor: /^[0-9a-f]{6}$/i.test(l.routeTextColor || '') ? `#${l.routeTextColor}` : '#ffffff',
    from: { name: l.from.name, time: new Date(l.startTime), track: l.from.track },
    to: { name: l.to.name, time: new Date(l.endTime) },
    duration: l.duration,
    distance: l.distance || 0,
    stops: l.intermediateStops?.length || 0,
    realTime: !!l.realTime,
    coords: l.legGeometry ? decodePolyline(l.legGeometry.points, l.legGeometry.precision ?? 6) : [],
  }));
  return { duration: it.duration, start: new Date(it.startTime), end: new Date(it.endTime), transfers: it.transfers ?? 0, legs };
}

/** Trajets en transports en commun maintenant, de from vers to ({ lon, lat }). */
export async function planTransit(from, to, signal) {
  const json = await get('/api/v4/plan', { fromPlace: latlon(from), toPlace: latlon(to), time: new Date().toISOString() }, { signal, timeoutMs: 45000 });
  const all = [...(json.itineraries || []), ...(json.direct || [])].map(parseItinerary);
  if (!all.length) throw new AppError('notransit');
  return all.sort((a, b) => a.end - b.end).slice(0, 6);
}

// ── Véhicules en circulation ─────────────────────────────────
/**
 * Segments de trajets (entre deux arrêts) dans la zone visible et les prochaines minutes.
 * Le serveur filtre selon le zoom : grandes lignes vues de loin, bus et trams de près.
 */
const corner = (lat, lon) => `${lat.toFixed(5)},${lon.toFixed(5)}`;

/** box : { s, w, n, e } en degrés. */
export async function fetchSegments(box, zoom, signal) {
  const now = Date.now();
  const list = await get('/api/v4/map/trips', {
    zoom: Math.floor(zoom),
    min: corner(box.s, box.w),
    max: corner(box.n, box.e),
    startTime: new Date(now).toISOString(),
    endTime: new Date(now + CONFIG.transit.windowMin * 60000).toISOString(),
  }, { signal });
  return list.map((seg) => {
    const coords = decodePolyline(seg.polyline, 5);
    return {
      mode: seg.mode,
      name: seg.trips?.[0]?.displayName || seg.trips?.[0]?.routeShortName || '',
      color: lineColor(seg.routeColor, seg.mode),
      to: seg.to?.name || '',
      dep: Date.parse(seg.departure),
      arr: Date.parse(seg.arrival),
      coords,
      cum: cumulative(coords),
    };
  });
}

/** Position de chaque véhicule à l'instant t (interpolée le long du tracé entre deux arrêts). */
export function vehiclePositions(segments, t = Date.now()) {
  const out = [];
  for (const s of segments) {
    if (t < s.dep || t > s.arr || s.coords.length < 2) continue;
    const target = ((t - s.dep) / Math.max(1, s.arr - s.dep)) * s.cum[s.cum.length - 1];
    let i = 1;
    while (i < s.cum.length - 1 && s.cum[i] < target) i++;
    const seg = s.cum[i] - s.cum[i - 1] || 1, f = (target - s.cum[i - 1]) / seg;
    const [a, b] = [s.coords[i - 1], s.coords[i]];
    out.push({ lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, mode: s.mode, name: s.name, color: s.color, to: s.to });
  }
  return out;
}

// ── Arrêts et départs ───────────────────────────────────────
export async function fetchStops(box, signal) {
  const list = await get('/api/v1/map/stops', { min: corner(box.s, box.w), max: corner(box.n, box.e) }, { signal });
  return list.filter((p) => p.stopId).map((p) => ({ id: p.stopId, name: p.name, lon: p.lon, lat: p.lat }));
}

export async function fetchDepartures(stopId) {
  const json = await get('/api/v4/stoptimes', { stopId, n: 12 });
  return (json.stopTimes || []).map((st) => ({
    time: new Date(st.place.departure || st.place.scheduledDeparture),
    delayed: st.realTime && st.place.departure !== st.place.scheduledDeparture,
    realTime: !!st.realTime,
    mode: st.mode,
    name: st.displayName || st.routeShortName || modeInfo(st.mode).label,
    color: lineColor(st.routeColor, st.mode),
    textColor: /^[0-9a-f]{6}$/i.test(st.routeTextColor || '') ? `#${st.routeTextColor}` : '#ffffff',
    headsign: st.headsign || '',
    track: st.place.track || '',
    cancelled: !!(st.cancelled || st.tripCancelled),
  }));
}
