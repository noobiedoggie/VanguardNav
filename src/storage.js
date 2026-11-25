// Données stockées sur le téléphone (localStorage de la WebView, persistant).
function load(key, fallback) {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) || '{}') };
  } catch {
    return fallback;
  }
}
function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage plein ou indisponible : on continue sans persister */
  }
}

export const settings = load('vn.settings', {
  units: 'km', // 'km' | 'mi'
  theme: 'auto', // 'auto' | 'day' | 'night'
  mapType: 'plan', // 'plan' | 'satellite'
  navView: '3d', // '3d' | '2d'
  radars: true,
  voice: true,
  voiceURI: '', // '' = voix par défaut du téléphone
  avoidHighways: false,
  avoidTolls: false,
  avoidFerries: false,
  locationExplained: false,
  backgroundExplained: false,
});
export const saveSettings = () => save('vn.settings', settings);

// Lieu = { name, address, lon, lat }
export const places = load('vn.places', { home: null, work: null, recents: [], lastPos: null });
export const savePlaces = () => save('vn.places', places);

export function addRecent(place) {
  const same = (p) => Math.abs(p.lon - place.lon) < 1e-5 && Math.abs(p.lat - place.lat) < 1e-5;
  places.recents = [place, ...places.recents.filter((p) => !same(p))].slice(0, 12);
  savePlaces();
}
