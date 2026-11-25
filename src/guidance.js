// Moteur de guidage : position sur l'itinéraire, prochaine manœuvre, annonces vocales,
// détection de sortie de route. Pur (sans DOM ni carte) pour être testable.
import { CONFIG } from './config.js';
import { snapToLine, bearing } from './geo.js';
import { speakDistance } from './format.js';

const isDestination = (m) => m.type >= 4 && m.type <= 6;
const lcFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : '');

export class Guidance {
  constructor(route, { units = 'km', silentStart = false } = {}) {
    this.units = units;
    this.setRoute(route, silentStart);
  }

  setRoute(route, silentStart = false) {
    this.route = route;
    this.seg = 0;
    this.next = Math.min(1, route.maneuvers.length - 1);
    this.offCount = 0;
    this.spoken = new Set(silentStart ? ['start'] : []);
    this.arrived = false;
    this.radarIdx = 0;
    this.radarsAlerted = new Set();
  }

  /** fix : { lon, lat, accuracy, speed } → état complet pour l'affichage. */
  update(fix) {
    const r = this.route, M = r.maneuvers, p = [fix.lon, fix.lat];
    let s = snapToLine(r.coords, r.cum, p, this.seg - 2, this.seg + 300);
    if (s.dist > 100) {
      const g = snapToLine(r.coords, r.cum, p); // perdu : recherche sur tout l'itinéraire
      if (g.dist < s.dist) s = g;
    }
    const tolerance = Math.max(CONFIG.nav.offRouteMeters, Math.min(fix.accuracy || 0, 100));
    const onRoute = s.dist <= tolerance;
    this.offCount = onRoute ? 0 : this.offCount + 1;

    if (onRoute) {
      this.seg = s.seg;
      while (this.next < M.length - 1 && r.cum[M[this.next].begin] <= s.along + 3) this.next++;
    }
    const along = s.along;
    const nm = M[this.next], cur = M[this.next - 1] || nm;
    const total = r.cum[r.cum.length - 1];
    const distToNext = Math.max(0, r.cum[nm.begin] - along);
    const remainingDist = Math.max(0, total - along);

    // Temps restant : part restante de la manœuvre en cours + manœuvres suivantes.
    const curLen = r.cum[cur.end] - r.cum[cur.begin];
    let remainingTime = curLen > 0 ? cur.time * Math.min(1, Math.max(0, (r.cum[cur.end] - along) / curLen)) : 0;
    for (let i = this.next; i < M.length; i++) remainingTime += M[i].time;

    const arrived = onRoute && isDestination(nm) && distToNext <= CONFIG.nav.arrivalMeters;
    const radar = onRoute ? this.#radar(along, fix.speed) : null;
    const speech = [this.#speech(onRoute, arrived, nm, distToNext, fix.speed), radar?.speech].filter(Boolean).join(' ') || null;
    if (arrived) this.arrived = true;

    const segEnd = r.coords[Math.min(s.seg + 1, r.coords.length - 1)];
    return {
      onRoute,
      offRoute: this.offCount >= CONFIG.nav.offRouteFixes,
      snapped: s.point,
      heading: onRoute && segEnd !== r.coords[s.seg] ? bearing(r.coords[s.seg], segEnd) : null,
      maneuver: nm,
      distToNext,
      remainingDist,
      remainingTime,
      arrived,
      speech,
      radar: radar?.visible ? { distance: radar.distance, maxspeed: radar.maxspeed } : null,
    };
  }

  /** Prochain radar sur l'itinéraire : visible à l'approche, annoncé une seule fois. */
  #radar(along, speed) {
    const list = this.route.radars;
    if (!list?.length) return null;
    while (this.radarIdx < list.length && list[this.radarIdx].along < along - 15) this.radarIdx++;
    const r = list[this.radarIdx];
    if (!r) return null;
    const v = Math.max(speed || 0, 8);
    const alertAt = v > 25 ? 800 : v > 14 ? 500 : 300;
    const distance = Math.max(0, r.along - along);
    let speech = null;
    if (distance <= alertAt && !this.radarsAlerted.has(this.radarIdx)) {
      // Radars groupés (deux sens, double cabine) : une seule annonce.
      for (let i = this.radarIdx; i < list.length && list[i].along - r.along < 150; i++) this.radarsAlerted.add(i);
      speech = `Radar dans ${speakDistance(distance, this.units)}${r.maxspeed ? `, limité à ${r.maxspeed}` : ''}.`;
    }
    return { visible: distance <= alertAt * 1.25, distance, maxspeed: r.maxspeed, speech };
  }

  #speech(onRoute, arrived, nm, d, speed) {
    const once = (key, text) => {
      if (this.spoken.has(key) || !text) return null;
      this.spoken.add(key);
      return text;
    };
    if (arrived) return once('arrived', nm.pre || 'Vous êtes arrivé.');
    if (!onRoute) return null;
    const start = once('start', this.route.maneuvers[0].pre);
    if (start) return start;

    const v = Math.max(speed || 0, 8); // m/s, au moins ~30 km/h
    const near = Math.max(v * 7, 60); // ~7 s avant la manœuvre
    const far = v > 25 ? 2000 : v > 15 ? 1000 : 400;
    const k = this.next;
    if (d <= near && !isDestination(nm)) {
      this.spoken.add(`${k}:far`);
      return once(`${k}:near`, nm.pre || nm.text);
    }
    if (d <= far && d > near * 1.5) {
      return once(`${k}:far`, `Dans ${speakDistance(d, this.units)}, ${lcFirst(nm.alert || nm.pre || nm.text)}`);
    }
    return null;
  }
}
