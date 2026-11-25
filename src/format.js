// Formatage des distances, durées et vitesses (km ou miles).
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const MI = 1609.344, FT = 3.28084;

export function fmtDistance(m, units) {
  if (units === 'mi') {
    if (m < 0.1 * MI) return `${Math.round((m * FT) / 50) * 50} ft`;
    const mi = m / MI;
    return `${mi < 10 ? nf1.format(mi) : Math.round(mi)} mi`;
  }
  const r = m < 100 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
  if (r < 1000) return `${r} m`;
  return `${m < 10000 ? nf1.format(m / 1000) : Math.round(m / 1000)} km`;
}

/** Version parlée : « 300 mètres », « 1,5 kilomètre », « 2 miles ». */
export function speakDistance(m, units) {
  if (units === 'mi') {
    if (m < 0.2 * MI) return `${Math.max(100, Math.round((m * FT) / 100) * 100)} pieds`;
    const mi = Math.round((m / MI) * 10) / 10;
    return `${nf1.format(mi)} ${mi >= 2 ? 'miles' : 'mile'}`;
  }
  if (m < 950) return `${Math.max(50, Math.round(m / 50) * 50)} mètres`;
  const km = Math.round(m / 100) / 10;
  return `${nf1.format(km)} ${km >= 2 ? 'kilomètres' : 'kilomètre'}`;
}

export function fmtDuration(sec) {
  const min = Math.max(1, Math.round(sec / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export const fmtClock = (date) => date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export const fmtSpeed = (ms, units) => Math.round((ms || 0) * (units === 'mi' ? 2.23694 : 3.6));
export const speedUnit = (units) => (units === 'mi' ? 'mph' : 'km/h');
