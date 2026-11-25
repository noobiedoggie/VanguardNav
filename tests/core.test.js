// Tests de la logique pure : géométrie, formatage, analyse Valhalla, moteur de guidage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, haversine, snapToLine, cumulative, isNight } from '../src/geo.js';
import { fmtDistance, speakDistance, fmtDuration } from '../src/format.js';
import { parseTrip } from '../src/routing.js';
import { Guidance } from '../src/guidance.js';

const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('décodage de polyligne (exemple de référence, précision 5)', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
});

test('distance et projection sur la route', () => {
  near(haversine([2.3522, 48.8566], [-0.5792, 44.8378]), 499000, 3000); // Paris → Bordeaux
  const line = [[2.35, 48.85], [2.35, 48.86]];
  const s = snapToLine(line, cumulative(line), [2.3505, 48.855]);
  near(s.dist, 36.7, 1);
  near(s.along, 556, 2);
});

test('jour / nuit selon le soleil', () => {
  assert.equal(isNight(new Date('2026-06-21T12:00:00Z'), 48.85, 2.35), false);
  assert.equal(isNight(new Date('2026-06-21T23:30:00Z'), 48.85, 2.35), true);
  assert.equal(isNight(new Date('2026-12-21T17:00:00Z'), 48.85, 2.35), true); // 18 h à Paris en hiver
});

test('formatage des distances et durées', () => {
  assert.equal(fmtDistance(40, 'km'), '40 m');
  assert.equal(fmtDistance(980, 'km'), '1 km');
  assert.equal(fmtDistance(1234, 'km'), '1,2 km');
  assert.equal(fmtDistance(25000, 'km'), '25 km');
  assert.equal(fmtDistance(3218.7, 'mi'), '2 mi');
  assert.equal(speakDistance(1500, 'km'), '1,5 kilomètre');
  assert.equal(speakDistance(380, 'km'), '400 mètres');
  assert.equal(fmtDuration(3900), '1 h 05');
});

// Itinéraire synthétique : 1 km vers le nord, virage à droite, 500 m vers l'est.
const LAT = 0.0008993, LON = 0.0013666; // ≈ 100 m à cette latitude
const coords = [];
for (let i = 0; i <= 10; i++) coords.push([2.35, 48.85 + i * LAT]);
for (let i = 1; i <= 5; i++) coords.push([2.35 + i * LON, 48.85 + 10 * LAT]);
const trip = {
  summary: { time: 108, length: 1.5, has_toll: true },
  legs: [{
    shape: '', // remplacé ci-dessous
    maneuvers: [
      { type: 1, begin_shape_index: 0, end_shape_index: 10, time: 72, length: 1, instruction: 'Roulez vers le nord.', verbal_pre_transition_instruction: 'Roulez vers le nord sur Rue A.', street_names: ['Rue A'] },
      { type: 10, begin_shape_index: 10, end_shape_index: 15, time: 36, length: 0.5, instruction: 'Tournez à droite sur Rue B.', verbal_transition_alert_instruction: 'Tournez à droite sur Rue B.', verbal_pre_transition_instruction: 'Tournez à droite sur Rue B.', street_names: ['Rue B'] },
      { type: 4, begin_shape_index: 15, end_shape_index: 15, time: 0, length: 0, instruction: 'Vous êtes arrivé.', verbal_pre_transition_instruction: 'Vous êtes arrivé à votre destination.' },
    ],
  }],
};

function route() {
  const r = parseTrip({ ...trip, legs: [{ ...trip.legs[0], shape: 'x' }] });
  return { ...r, coords, cum: cumulative(coords) }; // on court-circuite la polyligne
}

test('analyse d’un trajet Valhalla', () => {
  const r = parseTrip({ ...trip, legs: [{ ...trip.legs[0], shape: '_p~iF~ps|U' }] }, 1000);
  assert.equal(r.length, 1500);
  assert.equal(r.hasToll, true);
  assert.equal(r.maneuvers[1].street, 'Rue B');
  assert.equal(r.maneuvers[1].begin, 10);
});

test('guidage : annonces, progression, sortie de route, arrivée', () => {
  const g = new Guidance(route());
  const at = (i, speed = 14) => g.update({ lon: coords[0][0], lat: 48.85 + i * LAT, accuracy: 5, speed });

  const s0 = at(0);
  assert.equal(s0.speech, 'Roulez vers le nord sur Rue A.');
  near(s0.distToNext, 1000, 5);
  near(s0.remainingTime, 108, 1);
  near(s0.heading, 0, 1);

  const spoken = [];
  for (let i = 0.5; i <= 9.6; i += 0.5) {
    const s = at(i);
    if (s.speech) spoken.push(s.speech);
  }
  assert.deepEqual(spoken, ['Dans 400 mètres, tournez à droite sur Rue B.', 'Tournez à droite sur Rue B.']);

  // Après le virage : prochaine manœuvre = arrivée.
  const after = g.update({ lon: coords[12][0], lat: coords[12][1], accuracy: 5, speed: 14 });
  assert.equal(after.maneuver.type, 4);
  near(after.remainingDist, 300, 5);
  near(after.heading, 90, 1);

  // Trois positions à 200 m de la route → recalcul demandé.
  const off = { lon: coords[12][0], lat: coords[12][1] + 2 * LAT, accuracy: 5, speed: 14 };
  assert.equal(g.update(off).offRoute, false);
  assert.equal(g.update(off).offRoute, false);
  assert.equal(g.update(off).offRoute, true);

  // Arrivée.
  const end = g.update({ lon: coords[15][0] - 0.0001, lat: coords[15][1], accuracy: 5, speed: 3 });
  assert.equal(end.arrived, true);
  assert.equal(end.speech, 'Vous êtes arrivé à votre destination.');
});

test('guidage après recalcul : pas de consigne de départ répétée', () => {
  const g = new Guidance(route(), { silentStart: true });
  assert.equal(g.update({ lon: 2.35, lat: 48.85, accuracy: 5, speed: 14 }).speech, null);
});

// ── Styles de carte ────────────────────────────────────────
import { parseColor, nightStyle, satelliteStyle } from '../src/styles.js';
import { radarsOnRoute } from '../src/radars.js';

const MINI = {
  version: 8,
  sources: { openmaptiles: { type: 'vector' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'water', type: 'fill', paint: { 'fill-color': 'rgb(158,189,255)' } },
    { id: 'road_minor_casing', type: 'line', paint: { 'line-color': '#cfcdca' } },
    { id: 'road_minor', type: 'line', paint: { 'line-color': '#fff' } },
    { id: 'road_motorway', type: 'line', paint: { 'line-color': ['interpolate', ['linear'], ['zoom'], 5, 'hsl(26,87%,62%)', 6, '#fc8'] } },
    { id: 'label_city', type: 'symbol', layout: { 'text-field': '{name}' }, paint: { 'text-color': '#000', 'text-halo-color': '#fff' } },
  ],
};
const L = (c) => parseColor(c)[2];

test('couleurs : formats hex, rgb, hsla', () => {
  assert.deepEqual(parseColor('#fff'), [0, 0, 1, 1]);
  assert.equal(parseColor('hsla(35,57%,88%,0.49)')[3], 0.49);
  near(parseColor('rgb(158,189,255)')[0], 221, 1);
  assert.equal(parseColor('{name}'), null);
});

test('plan nuit : fond sombre, routes visibles, textes clairs', () => {
  const n = nightStyle(MINI), p = (id) => n.layers.find((l) => l.id === id).paint;
  const bg = L(p('background')['background-color']);
  assert.ok(bg < 0.2);
  assert.ok(L(p('road_minor')['line-color']) > bg + 0.2, 'route plus claire que le fond');
  assert.ok(L(p('road_minor_casing')['line-color']) < L(p('road_minor')['line-color']), 'bordure plus sombre que la route');
  assert.ok(L(p('road_motorway')['line-color'][6]) > bg + 0.15, 'expressions transformées aussi');
  assert.ok(L(p('label_city')['text-color']) > 0.85);
  assert.ok(L(p('label_city')['text-halo-color']) < 0.15);
  assert.equal(MINI.layers[0].paint['background-color'], '#f8f4f0', 'style d’origine intact');
});

test('satellite : imagerie + routes + noms, sans aplats', () => {
  const s = satelliteStyle(MINI), ids = s.layers.map((l) => l.id);
  assert.deepEqual(ids, ['background', 'satellite', 'road_minor', 'road_motorway', 'label_city']);
  assert.equal(s.sources.satellite.type, 'raster');
});

test('radars : seuls ceux sur la route sont gardés, dans l’ordre du trajet', () => {
  const r = route();
  const nodes = [
    { lon: coords[13][0], lat: coords[13][1] + 0.00005, maxspeed: 50 }, // sur Rue B, ~6 m
    { lon: coords[4][0] + 0.00008, lat: coords[4][1], maxspeed: 90 }, // sur Rue A, ~6 m
    { lon: coords[4][0] + 0.002, lat: coords[4][1], maxspeed: 70 }, // à ~150 m : ignoré
  ];
  const found = radarsOnRoute(r, nodes);
  assert.deepEqual(found.map((x) => x.maxspeed), [90, 50]);
  near(found[0].along, 400, 5);
});

test('guidage : alerte radar annoncée une fois, avec la limite', () => {
  const r = route();
  r.radars = [{ lon: 2.35, lat: 48.85 + 5 * LAT, maxspeed: 50, along: 500 }];
  const g = new Guidance(r, { silentStart: true });
  const at = (m) => g.update({ lon: 2.35, lat: 48.85 + (m / 100) * LAT, accuracy: 5, speed: 14 });
  assert.equal(at(0).radar, null);
  const a = at(150); // radar à 350 m (seuil 300 m à 50 km/h, visible dès 375 m)
  assert.equal(a.radar.maxspeed, 50);
  assert.equal(a.speech, null);
  const b = at(220);
  assert.equal(b.speech, 'Radar dans 300 mètres, limité à 50.');
  assert.equal(at(260).speech, null);
  assert.equal(at(530).radar, null, 'radar dépassé');
});

// ── Longs trajets et transports en commun ──────────────────
import { parseItinerary, vehiclePositions } from '../src/transit.js';
import { fmtClock } from '../src/format.js';

test('long trajet : « Continuez pendant… » après une manœuvre, heure d’arrivée avec le jour', () => {
  // 1 km nord, virage, puis 9 km vers l'est.
  const c = [];
  for (let i = 0; i <= 10; i++) c.push([2.35, 48.85 + i * LAT]);
  for (let i = 1; i <= 90; i++) c.push([2.35 + i * LON, 48.85 + 10 * LAT]);
  const r = {
    coords: c, cum: cumulative(c), time: 600, length: 10000,
    maneuvers: [
      { type: 1, begin: 0, end: 10, time: 60, pre: 'Roulez vers le nord.' },
      { type: 10, begin: 10, end: 100, time: 540, pre: 'Tournez à droite sur l’A4.', post: 'Continuez pendant 9 kilomètres.' },
      { type: 4, begin: 100, end: 100, time: 0, pre: 'Vous êtes arrivé.' },
    ],
  };
  const g = new Guidance(r, { silentStart: true });
  g.update({ lon: 2.35, lat: 48.85 + 9.5 * LAT, accuracy: 5, speed: 14 });
  const after = g.update({ lon: c[12][0], lat: c[12][1], accuracy: 5, speed: 25 });
  assert.equal(after.speech, 'Continuez pendant 9 kilomètres.');
  assert.equal(g.update({ lon: c[13][0], lat: c[13][1], accuracy: 5, speed: 25 }).speech, null);

  const now = new Date('2026-11-25T10:00:00');
  assert.equal(fmtClock(new Date('2026-11-25T14:05:00'), now), '14:05');
  assert.match(fmtClock(new Date('2026-11-26T08:15:00'), now), /^jeu\.? 08:15$/);
});

test('transports : analyse d’un trajet MOTIS et position des véhicules', () => {
  const it = parseItinerary({
    duration: 1500, startTime: '2026-11-25T08:00:00Z', endTime: '2026-11-25T08:25:00Z', transfers: 0,
    legs: [
      { mode: 'WALK', from: { name: 'Départ' }, to: { name: 'Gare' }, startTime: '2026-11-25T08:00:00Z', endTime: '2026-11-25T08:05:00Z', duration: 300, distance: 350, legGeometry: { points: '_p~iF~ps|U_ulLnnqC', precision: 5, length: 2 } },
      { mode: 'BUS', displayName: '42', headsign: 'Mairie', routeColor: 'FF8800', routeTextColor: '000000', realTime: true,
        from: { name: 'Gare', track: 'B' }, to: { name: 'Mairie' }, startTime: '2026-11-25T08:05:00Z', endTime: '2026-11-25T08:25:00Z', duration: 1200,
        intermediateStops: [{}, {}, {}], legGeometry: { points: '_p~iF~ps|U_ulLnnqC', precision: 5, length: 2 } },
    ],
  });
  assert.equal(it.legs[1].name, '42');
  assert.equal(it.legs[1].color, '#FF8800');
  assert.equal(it.legs[1].textColor, '#000000');
  assert.equal(it.legs[1].stops, 3);
  assert.deepEqual(it.legs[1].coords[1], [-120.95, 40.7]);
  assert.equal(it.legs[0].color, '#8A93A6', 'marche : couleur par défaut');

  const coords = [[2.35, 48.85], [2.35, 48.86]];
  const seg = { mode: 'TRAM', name: 'T3', color: '#D6246E', to: 'Porte', dep: 0, arr: 100000, coords, cum: cumulative(coords) };
  const [v] = vehiclePositions([seg], 25000);
  near(v.lat, 48.8525, 1e-6);
  assert.equal(vehiclePositions([seg], 100001).length, 0, 'segment terminé');
});
