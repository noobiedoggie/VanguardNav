// Recherche d'adresses avec Photon.
import { CONFIG } from './config.js';
import { AppError, fetchJson } from './routing.js';

function toPlace(f) {
  const p = f.properties || {};
  const [lon, lat] = f.geometry.coordinates;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const city = [p.postcode, p.city || p.town || p.village].filter(Boolean).join(' ');
  const name = p.name || street || city || p.country || 'Lieu';
  const address = [p.name ? street : '', city, p.country].filter((s) => s && s !== name).join(', ');
  return { name, address, lon, lat };
}

async function photon(base, params, signal) {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  let r = await fetchJson(url, { signal });
  if (r.status === 400 && url.searchParams.has('lang')) {
    url.searchParams.delete('lang'); // langue non prise en charge par ce serveur
    r = await fetchJson(url, { signal });
  }
  if (!r.ok || !r.json) throw new AppError('server');
  return r.json.features || [];
}

/** near : { lon, lat } pour favoriser les résultats proches. */
export async function searchPlaces(q, near, signal) {
  const s = CONFIG.search;
  const feats = await photon(s.url, { q, limit: s.limit, lang: s.lang, lat: near?.lat, lon: near?.lon }, signal);
  return feats.map(toPlace);
}

export async function reverseGeocode(lon, lat) {
  try {
    const [f] = await photon(CONFIG.search.reverseUrl, { lon, lat, lang: CONFIG.search.lang });
    if (f) return { ...toPlace(f), lon, lat };
  } catch {
    /* pas grave : on garde les coordonnées */
  }
  return { name: 'Point sur la carte', address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lon, lat };
}
