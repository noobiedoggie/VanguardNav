// Géométrie : distances, caps, projection sur une polyligne, soleil.
const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distance en mètres entre deux points [lon, lat]. */
export function haversine([lon1, lat1], [lon2, lat2]) {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Cap (0–360°, 0 = nord) de a vers b. */
export function bearing([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x =
    Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Polyligne encodée (format Google/Valhalla, précision 6) → [[lon, lat], …]. */
export function decodePolyline(str, precision = 6) {
  const factor = 10 ** precision;
  const out = [];
  let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (let k = 0; k < 2; k++) {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d;
      else lon += d;
    }
    out.push([lon / factor, lat / factor]);
  }
  return out;
}

/** Distances cumulées (m) le long de la polyligne. */
export function cumulative(coords) {
  const c = [0];
  for (let i = 1; i < coords.length; i++) c.push(c[i - 1] + haversine(coords[i - 1], coords[i]));
  return c;
}

/**
 * Projette p sur la polyligne, segments [from, to[ seulement.
 * Approximation plane locale : précise à l'échelle d'une rue, et rapide.
 * → { dist (m à la route), seg, along (m depuis le départ), point [lon, lat] }
 */
export function snapToLine(coords, cum, p, from = 0, to = coords.length - 1) {
  const kx = Math.cos(rad(p[1])) * 111320, ky = 110540;
  let best = { dist: Infinity, seg: 0, along: 0, point: coords[0] };
  for (let i = Math.max(0, from); i < Math.min(to, coords.length - 1); i++) {
    const ax = (coords[i][0] - p[0]) * kx, ay = (coords[i][1] - p[1]) * ky;
    const dx = (coords[i + 1][0] - p[0]) * kx - ax, dy = (coords[i + 1][1] - p[1]) * ky - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.dist) {
      best = {
        dist: d,
        seg: i,
        along: cum[i] + t * (cum[i + 1] - cum[i]),
        point: [
          coords[i][0] + t * (coords[i + 1][0] - coords[i][0]),
          coords[i][1] + t * (coords[i + 1][1] - coords[i][1]),
        ],
      };
    }
  }
  return best;
}

/** Hauteur du soleil en degrés (formule astronomique simplifiée, précision ~1°). */
export function sunAltitude(date, lat, lon) {
  const d = date.getTime() / 86400000 - 10957.5; // jours depuis J2000
  const g = rad(357.529 + 0.98560028 * d);
  const L = rad(280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g));
  const e = rad(23.439 - 0.00000036 * d);
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = 18.697374558 + 24.06570982441908 * d; // heures
  const ha = rad(gmst * 15 + lon) - ra;
  return deg(Math.asin(Math.sin(rad(lat)) * Math.sin(dec) + Math.cos(rad(lat)) * Math.cos(dec) * Math.cos(ha)));
}

export const isNight = (date, lat, lon) => sunAltitude(date, lat, lon) < -0.833;
