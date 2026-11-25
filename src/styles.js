// Variantes du style « Liberty » (OpenFreeMap) : nuit façon GPS et satellite avec routes et noms.
// Fonctions pures : elles reçoivent le style JSON téléchargé et en renvoient une copie modifiée.
import { CONFIG } from './config.js';

// ── Couleurs ────────────────────────────────────────────────
const NAMED = { white: '#ffffff', black: '#000000' };

/** '#rgb' | '#rrggbb' | 'rgb[a](…)' | 'hsl[a](…)' → [h, s, l, a] (s, l entre 0 et 1) ou null. */
export function parseColor(str) {
  if (typeof str !== 'string') return null;
  const c = (NAMED[str.trim().toLowerCase()] || str).trim();
  let m;
  if ((m = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join('') : m[1];
    return rgbToHsl(parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1);
  }
  if ((m = c.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)))
    return rgbToHsl(+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]);
  if ((m = c.match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*(?:,\s*([\d.]+)\s*)?\)$/i)))
    return [+m[1], m[2] / 100, m[3] / 100, m[4] == null ? 1 : +m[4]];
  return null;
}

function rgbToHsl(r, g, b, a) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l, a];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l, a];
}

const clamp = (v) => Math.min(1, Math.max(0, v));
const hsla = ([h, s, l, a]) => `hsla(${Math.round(h)},${Math.round(clamp(s) * 100)}%,${Math.round(clamp(l) * 100)}%,${+a.toFixed(3)})`;

/** Applique fn à chaque couleur trouvée dans une valeur de style (couleur simple, expression, stops). */
function mapColors(value, fn) {
  if (Array.isArray(value)) return value.map((v) => mapColors(v, fn));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapColors(v, fn)]));
  const c = parseColor(value);
  return c ? hsla(fn(c)) : value;
}

// ── Nuit : fond bleu nuit, routes plus claires que le fond, textes clairs ──
const NIGHT_HUE = 220;
function nightColor(layer, prop, [h, s, l, a]) {
  const id = layer.id;
  if (prop === 'text-halo-color') return [NIGHT_HUE, 0.3, 0.09, a];
  if (prop.startsWith('text-') || prop.startsWith('icon-')) return [h, s * 0.6, 0.92 - l * 0.3, a];
  if (layer.type === 'background') return [NIGHT_HUE, 0.28, 0.13, a];
  if (/water/.test(id)) return [215, 0.45, layer.type === 'line' ? 0.25 : 0.09, a];
  if (/building/.test(id)) return [NIGHT_HUE, 0.14, 0.2, a];
  if (layer.type === 'line' && /^(road|tunnel|bridge)_/.test(id) && !/rail/.test(id)) {
    // Remplissage des routes ~0,40 de luminosité, bordures ~0,20 : lisibles sur le fond à 0,13.
    return /casing/.test(id) ? [h, s * 0.35, 0.14 + l * 0.08, a] : [h, s * 0.45, 0.2 + l * 0.2, a];
  }
  if (layer.type === 'line') return [h, s * 0.3, 0.22 + l * 0.12, a];
  return [h, s * 0.35, 0.11 + (l - 0.7) * 0.15, a]; // landuse, parcs, forêts…
}

export function nightStyle(style) {
  return {
    ...style,
    layers: style.layers.map((layer) => {
      if (layer.type === 'raster') return { ...layer, paint: { ...layer.paint, 'raster-brightness-max': 0.3, 'raster-saturation': -0.4 } };
      if (!layer.paint) return layer;
      const paint = Object.fromEntries(
        Object.entries(layer.paint).map(([k, v]) => [k, k.endsWith('-color') ? mapColors(v, (c) => nightColor(layer, k, c)) : v])
      );
      return { ...layer, paint };
    }),
  };
}

// ── Satellite : imagerie + routes semi-transparentes + noms (textes blancs) ──
export function satelliteStyle(style) {
  const keep = (l) => l.type === 'symbol' || (l.type === 'line' && /^(road|bridge|tunnel)_/.test(l.id) && !/casing|rail|path|pedestrian/.test(l.id));
  return {
    ...style,
    sources: {
      ...style.sources,
      satellite: { type: 'raster', tiles: [CONFIG.map.satelliteTiles], tileSize: 256, maxzoom: 19, attribution: CONFIG.map.satelliteAttribution },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b1020' } },
      { id: 'satellite', type: 'raster', source: 'satellite' },
      ...style.layers.filter(keep).map((l) => {
        if (l.type === 'line') return { ...l, paint: { ...l.paint, 'line-opacity': 0.45 } };
        if (!l.paint?.['text-color']) return l; // boucliers routiers : on garde leurs couleurs
        return { ...l, paint: { ...l.paint, 'text-color': '#ffffff', 'text-halo-color': 'rgba(0,0,0,0.75)' } };
      }),
    ],
  };
}

// ── Finitions communes : pas de bâtiments 3D (blocs gris illisibles en conduite) + ciel à l'horizon ──
const SKY = {
  day: { 'sky-color': '#9cc3ff', 'horizon-color': '#e9f1ff', 'fog-color': '#f2f0ec', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0 },
  night: { 'sky-color': '#070b16', 'horizon-color': '#1b2740', 'fog-color': '#111829', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7, 'fog-ground-blend': 0.4, 'atmosphere-blend': 0 },
};
export function finishStyle(style, night) {
  return { ...style, sky: SKY[night ? 'night' : 'day'], layers: style.layers.filter((l) => l.type !== 'fill-extrusion') };
}
