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
