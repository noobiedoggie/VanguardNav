// Pont vers les plugins Capacitor, avec repli navigateur pour développer sur PC.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { KeepAwake } from '@capacitor-community/keep-awake';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { CONFIG } from './config.js';
import { settings } from './storage.js';

export const isNative = Capacitor.isNativePlatform();
const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');
const ignore = () => {};

// ── Position ────────────────────────────────────────────────
let watchId = null;

/** 'granted' | 'prompt' | 'denied' */
export async function locationPermission() {
  try {
    if (isNative) {
      const { location } = await BackgroundGeolocation.checkPermissions();
      return location === 'granted' ? 'granted' : location === 'denied' ? 'denied' : 'prompt';
    }
    const p = await navigator.permissions?.query({ name: 'geolocation' });
    return p?.state || 'prompt';
  } catch {
    return 'prompt';
  }
}

/**
 * Suit la position. background=true : service de premier plan (notification),
 * la position continue d'arriver écran verrouillé / app en arrière-plan.
 * onFix({ lon, lat, accuracy, speed, heading, time }) ; onError('denied' | 'disabled' | 'unavailable')
 */
export async function watchLocation(background, onFix, onError) {
  await stopLocation();
  if (!isNative) {
    if (!navigator.geolocation) return onError('unavailable');
    watchId = navigator.geolocation.watchPosition(
      ({ coords: c, timestamp }) =>
        onFix({ lon: c.longitude, lat: c.latitude, accuracy: c.accuracy, speed: c.speed, heading: c.heading, time: timestamp }),
      (e) => onError(e.code === 1 ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 }
    );
    return;
  }
  const options = { requestPermissions: true, stale: false, distanceFilter: 0 };
  if (background) {
    options.backgroundTitle = 'Navigation en cours';
    options.backgroundMessage = 'Vanguard Navigator vous guide jusqu’à destination.';
  }
  let id = null;
  id = await BackgroundGeolocation.addWatcher(options, (loc, err) => {
    if (err) {
      // Le service natif peut ne pas être encore lié au tout premier lancement.
      if (/Service not running/i.test(err.message)) {
        setTimeout(() => watchId === id && watchLocation(background, onFix, onError), 500);
        return;
      }
      return onError(/disabled/i.test(err.message) ? 'disabled' : err.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
    }
    onFix({ lon: loc.longitude, lat: loc.latitude, accuracy: loc.accuracy, speed: loc.speed, heading: loc.bearing, time: loc.time });
  });
  watchId = id;
}

export async function stopLocation() {
  const id = watchId;
  watchId = null;
  if (id == null) return;
  if (isNative) await BackgroundGeolocation.removeWatcher({ id }).catch(ignore);
  else navigator.geolocation.clearWatch(id);
}

export const openAppSettings = () => isNative && BackgroundGeolocation.openSettings().catch(ignore);

// ── Notifications (Android 13+ : nécessaires pour la notification de navigation) ──
export async function ensureNotificationPermission() {
  if (!isNative) return true;
  try {
    let { display } = await LocalNotifications.checkPermissions();
    if (display.startsWith('prompt')) ({ display } = await LocalNotifications.requestPermissions());
    return display === 'granted';
  } catch {
    return false;
  }
}

// ── Voix ────────────────────────────────────────────────────
export async function listVoices() {
  try {
    const voices = isNative ? (await TextToSpeech.getSupportedVoices()).voices : speechSynthesis.getVoices();
    return voices.map((v, index) => ({ index, name: v.name, uri: v.voiceURI, lang: v.lang })).filter((v) => /^fr/i.test(v.lang));
  } catch {
    return [];
  }
}

export async function speak(text, force = false) {
  if ((!settings.voice && !force) || !text) return;
  try {
    const voice = settings.voiceURI ? (await listVoices()).find((v) => v.uri === settings.voiceURI) : null;
    if (isNative) {
      // QUEUE_FLUSH côté Android : une nouvelle annonce coupe la précédente.
      await TextToSpeech.speak({ text, lang: CONFIG.voiceLang, rate: 1, volume: 1, voice: voice?.index, category: 'playback' });
    } else {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = CONFIG.voiceLang;
      if (voice) u.voice = speechSynthesis.getVoices()[voice.index];
      speechSynthesis.speak(u);
    }
  } catch (e) {
    console.warn('Synthèse vocale indisponible', e);
  }
}

export function stopSpeaking() {
  if (isNative) TextToSpeech.stop().catch(ignore);
  else globalThis.speechSynthesis?.cancel();
}

// ── Écran, barre de statut, cycle de vie ────────────────────
export const keepAwake = (on) => isNative && (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(ignore);

export function setStatusBar(dark, color) {
  if (!isNative) return;
  StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(ignore); // Dark = texte clair
  StatusBar.setBackgroundColor({ color }).catch(ignore);
}

export const hideSplash = () => isNative && SplashScreen.hide({ fadeOutDuration: 250 }).catch(ignore);
export const onBackButton = (fn) => isNative && App.addListener('backButton', fn);
export const onResume = (fn) => isNative && App.addListener('resume', fn);
export const minimizeApp = () => isNative && App.minimizeApp().catch(ignore);
export const exitApp = () => isNative && App.exitApp().catch(ignore);
