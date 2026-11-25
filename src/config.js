// ─────────────────────────────────────────────────────────────
//  Vanguard Navigator — configuration des services
//  Tout est gratuit et sans clé API. Changez une URL ici pour
//  utiliser votre propre serveur (Photon, Valhalla, tuiles…).
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  map: {
    // Tuiles vectorielles OpenStreetMap (OpenFreeMap, sans clé). La version nuit
    // et la vue satellite sont dérivées de ce style (voir styles.js).
    style: 'https://tiles.openfreemap.org/styles/liberty',
    // Imagerie satellite Esri World Imagery (sans clé, attribution obligatoire).
    satelliteTiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satelliteAttribution: 'Imagerie © Esri, Maxar, Earthstar Geographics',
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
    timeoutMs: 45000, // un long trajet (> 1000 km) peut prendre du temps sur le serveur public
  },
  nav: {
    offRouteMeters: 45, // écart toléré avant de considérer qu'on a quitté la route
    offRouteFixes: 3, // nombre de positions consécutives hors route avant recalcul
    rerouteCooldownMs: 8000,
    arrivalMeters: 30,
  },
  radars: {
    // Radars fixes cartographiés dans OpenStreetMap (highway=speed_camera), via l'API Overpass.
    url: 'https://overpass-api.de/api/interpreter',
    maxDistance: 25, // m : au-delà, le radar n'est pas sur notre route
  },
  transit: {
    // Transitous : transports en commun du monde entier (projet communautaire, API MOTIS).
    url: 'https://api.transitous.org',
    windowMin: 10, // minutes de circulation chargées à chaque mise à jour des véhicules
    stopsMinZoom: 15,
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
