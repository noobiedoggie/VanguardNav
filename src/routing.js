// Calcul d'itinéraires avec Valhalla.
import { CONFIG } from './config.js';
import { decodePolyline, cumulative } from './geo.js';

export class AppError extends Error {
  constructor(kind, detail) {
    super(detail || kind);
    this.kind = kind; // 'offline' | 'timeout' | 'noroute' | 'nolocation' | 'toofar' | 'server'
  }
}

/** fetch avec délai maximum ; transforme les pannes réseau en AppError lisibles. */
export async function fetchJson(url, { timeoutMs = 12000, signal } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), timeoutMs);
  signal?.addEventListener('abort', () => ctrl.abort('cancel'));
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    if (ctrl.signal.aborted) throw new AppError(ctrl.signal.reason === 'cancel' ? 'cancel' : 'timeout');
    throw new AppError(navigator.onLine === false ? 'offline' : 'server', String(e));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * from/to : { lon, lat, heading? }. opts : { units, avoidHighways, avoidTolls, avoidFerries, alternates }
 * → liste d'itinéraires (le premier est le meilleur).
 */
export async function fetchRoutes(from, to, opts) {
  const auto = {};
  if (opts.avoidHighways) auto.use_highways = 0;
  if (opts.avoidTolls) auto.use_tolls = 0;
  if (opts.avoidFerries) auto.use_ferry = 0;
  const start = { lat: from.lat, lon: from.lon };
  // Le cap évite qu'un recalcul propose un demi-tour immédiat.
  if (from.heading != null) Object.assign(start, { heading: Math.round(from.heading), heading_tolerance: 45 });
  const body = {
    locations: [start, { lat: to.lat, lon: to.lon }],
    costing: 'auto',
    costing_options: { auto },
    directions_options: { units: opts.units === 'mi' ? 'miles' : 'kilometers', language: CONFIG.routing.language },
  };
  const alternates = opts.alternates ?? CONFIG.routing.alternates;
  if (alternates > 0) body.alternates = alternates;

  // GET ?json= : requête « simple », sans pré-vol CORS.
  const url = `${CONFIG.routing.url}?json=${encodeURIComponent(JSON.stringify(body))}`;
  const { ok, json } = await fetchJson(url, { timeoutMs: CONFIG.routing.timeoutMs, signal: opts.signal });
  if (!ok || !json?.trip) {
    const code = json?.error_code;
    const kind = [442, 443, 170].includes(code) ? 'noroute' : code === 171 ? 'nolocation' : code === 154 ? 'toofar' : 'server';
    throw new AppError(kind, json?.error);
  }
  const factor = opts.units === 'mi' ? 1609.344 : 1000; // Valhalla renvoie les longueurs dans l'unité demandée
  return [json.trip, ...(json.alternates || []).map((a) => a.trip)].map((t) => parseTrip(t, factor));
}

export function parseTrip(trip, factor = 1000) {
  const leg = trip.legs[0];
  const coords = decodePolyline(leg.shape);
  return {
    coords,
    cum: cumulative(coords),
    time: trip.summary.time,
    length: trip.summary.length * factor,
    hasToll: !!trip.summary.has_toll,
    hasHighway: !!trip.summary.has_highway,
    hasFerry: !!trip.summary.has_ferry,
    maneuvers: leg.maneuvers.map((m) => ({
      type: m.type,
      text: m.instruction,
      alert: m.verbal_transition_alert_instruction,
      pre: m.verbal_pre_transition_instruction,
      street: (m.street_names || m.begin_street_names || [])[0] || '',
      begin: m.begin_shape_index,
      end: m.end_shape_index,
      time: m.time,
    })),
  };
}
