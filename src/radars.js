// Radars fixes : nœuds OpenStreetMap highway=speed_camera le long de l'itinéraire (API Overpass).
import { CONFIG } from './config.js';
import { snapToLine } from './geo.js';
import { AppError, fetchJson } from './routing.js';

const PAD = 0.003; // ≈ 300 m de marge autour de chaque tronçon

/**
 * Découpe l'itinéraire en tronçons de ~25 km et renvoie leur boîte englobante
 * [sud, ouest, nord, est] + la plage de segments correspondante. Même un trajet de
 * 1000 km reste une petite requête, et chaque radar n'est comparé qu'à son tronçon.
 */
export function routeBoxes(route, step = 25000) {
  const { coords, cum } = route, boxes = [];
  let from = 0;
  while (from < coords.length - 1) {
    let to = from + 1;
    while (to < coords.length - 1 && cum[to] - cum[from] < step) to++;
    let s = 90, w = 180, n = -90, e = -180;
    for (let i = from; i <= to; i++) {
      const [lon, lat] = coords[i];
      s = Math.min(s, lat); n = Math.max(n, lat); w = Math.min(w, lon); e = Math.max(e, lon);
    }
    boxes.push({ bbox: [s - PAD, w - PAD, n + PAD, e + PAD], from, to });
    from = to;
  }
  return boxes;
}

/** Radars proches de l'itinéraire, triés par distance depuis le départ (m). */
export function radarsOnRoute(route, nodes) {
  const boxes = routeBoxes(route), found = [];
  for (const node of nodes) {
    let best = Infinity, along = 0;
    for (const { bbox: [s, w, n, e], from, to } of boxes) {
      if (node.lat < s || node.lat > n || node.lon < w || node.lon > e) continue;
      const p = snapToLine(route.coords, route.cum, [node.lon, node.lat], from, to + 1);
      if (p.dist < best) [best, along] = [p.dist, p.along];
    }
    if (best <= CONFIG.radars.maxDistance) found.push({ ...node, along });
  }
  return found.sort((a, b) => a.along - b.along);
}

/** Charge les radars de plusieurs itinéraires en une seule requête et les range dans route.radars. */
export async function loadRadars(routes) {
  const boxes = routes.flatMap((r) => routeBoxes(r));
  const query = `[out:json][timeout:90];(${boxes.map(({ bbox }) => `node["highway"="speed_camera"](${bbox.map((v) => v.toFixed(5)).join(',')});`).join('')});out;`;
  const { ok, json } = await fetchJson(CONFIG.radars.url, { method: 'POST', body: new URLSearchParams({ data: query }), timeoutMs: 100000 });
  if (!ok || !Array.isArray(json?.elements)) throw new AppError('server');
  const nodes = json.elements.map((el) => ({ lon: el.lon, lat: el.lat, maxspeed: parseInt(el.tags?.maxspeed, 10) || null }));
  for (const r of routes) r.radars = radarsOnRoute(r, nodes);
}
