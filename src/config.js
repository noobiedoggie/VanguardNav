// ─────────────────────────────────────────────────────────────
//  Vanguard Navigator — configuration des services
//  Tout est gratuit et sans clé API. Changez une URL ici pour
//  utiliser votre propre serveur (Photon, Valhalla, tuiles…).
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  map: {
    // Tuiles vectorielles OpenStreetMap (OpenFreeMap, sans clé).
    styleDay: 'https://tiles.openfreemap.org/styles/liberty',
    styleNight: 'https://tiles.openfreemap.org/styles/dark',
    defaultCenter: [2.3522, 48.8566], // avant le premier fix GPS
    defaultZoom: 12,
  },
  search: {
    // Photon (komoot) : conçu pour l'autocomplétion. Nominatim l'interdit.
    url: 'https://photon.komoot.io/api/',
    reverseUrl: 'https://photon.komoot.io/reverse',
    lang: 'fr',
    limit: 8,
    debounceMs: 250,
  },
  routing: {
    // Valhalla (FOSSGIS) : instructions vocales détaillées en français.
    // Conditions : 1 requête/seconde max.
    url: 'https://valhalla1.openstreetmap.de/route',
    language: 'fr-FR',
    alternates: 2, // + l'itinéraire principal = 3 au maximum
    timeoutMs: 15000,
  },
  nav: {
    offRouteMeters: 45, // écart toléré avant de considérer qu'on a quitté la route
    offRouteFixes: 3, // nombre de positions consécutives hors route avant recalcul
    rerouteCooldownMs: 8000,
    arrivalMeters: 30,
  },
  voiceLang: 'fr-FR',
};

// Secours si le style vectoriel ne charge pas : tuiles raster officielles OpenStreetMap.
export const OSM_RASTER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};
