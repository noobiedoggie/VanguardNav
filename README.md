# Vanguard Navigator

Navigation GPS Android minimaliste : carte plan (jour/nuit) ou satellite, recherche d’adresses, jusqu’à 3 itinéraires, guidage vocal en français, vue 3D ou 2D, alertes radars, recalcul automatique, et un mode **transports en commun** mondial (trajets, véhicules en direct, départs aux arrêts). Aucune clé API, aucun service payant.

## 1. Pousser le code

```bash
git add -A
git commit -m "Mon changement"
git push
```

Chaque push lance automatiquement la compilation sur GitHub (onglet **Actions**, ~5 min). Pas besoin d’Android Studio.

## 2. Télécharger l’APK

- **À chaque push** : onglet **Actions** → dernier run « Build APK » (coche verte) → en bas, section **Artifacts** → `VanguardNavigator-N`. C’est un zip qui contient l’APK.
- **Version publiée** : créez un tag, l’APK apparaît dans l’onglet **Releases** :
  ```bash
  git tag v1.0.0 && git push origin v1.0.0
  ```

## 3. Installer sur le téléphone

1. Ouvrez le zip et copiez `VanguardNavigator-N-debug.apk` sur le téléphone (ou téléchargez-le directement depuis GitHub sur le téléphone).
2. Touchez le fichier. Android demande d’**autoriser l’installation d’applications inconnues** pour votre navigateur ou gestionnaire de fichiers : acceptez.
3. Au premier lancement, autorisez la **position**. Au premier trajet, autorisez les **notifications** : elles permettent le guidage écran verrouillé.

Les nouvelles versions s’installent par-dessus l’ancienne (même signature, favoris conservés). Android 7.0 minimum.

## APK de release signé (facultatif)

Sans configuration, la CI produit un APK *debug*, parfaitement utilisable. Pour un APK *release* signé avec votre propre clé :

```bash
keytool -genkeypair -v -keystore release.jks -alias vanguard -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 release.jks > release.jks.b64
```

Dans GitHub → **Settings → Secrets and variables → Actions**, créez :
`ANDROID_KEYSTORE_BASE64` (contenu de `release.jks.b64`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` (`vanguard`), `ANDROID_KEY_PASSWORD`.
Gardez `release.jks` hors du dépôt et en lieu sûr : sans elle, impossible de publier une mise à jour.

## Services utilisés

Tous réglables en haut de [`src/config.js`](src/config.js) :

| Rôle | Service |
|---|---|
| Carte plan | MapLibre GL JS + tuiles OpenStreetMap (OpenFreeMap « Liberty », version nuit dérivée ; secours : tile.openstreetmap.org) |
| Satellite | Esri World Imagery |
| Radars | Radars fixes OpenStreetMap (`highway=speed_camera`) via l’API Overpass |
| Recherche | Photon (komoot) |
| Transports en commun | Transitous (API MOTIS, données GTFS du monde entier, communautaire) |
| Itinéraires | Valhalla (FOSSGIS) — 1 requête/s max |

## Structure

```
src/config.js     URLs des services et seuils de guidage
src/map.js        carte, couches d’itinéraire, caméra de navigation
src/search.js     recherche et géocodage inverse
src/routing.js    appel Valhalla, analyse des trajets
src/radars.js     radars le long de l’itinéraire (Overpass)
src/styles.js     variantes nuit et satellite du style de carte
src/transit.js    transports en commun : trajets, véhicules, arrêts, départs (Transitous)
src/guidance.js   moteur de guidage (annonces, sortie de route, arrivée) — sans DOM, testé
src/native.js     plugins Capacitor (GPS arrière-plan, voix, écran allumé, barre de statut)
src/main.js       logique d’écran
android/          projet Android Capacitor
assets/           sources de l’icône et de l’écran de démarrage
```

Les services gratuits sont partagés : pour une diffusion publique de l’app, prévenez Transitous (transitous.org) et hébergez idéalement vos propres serveurs.

Développement sur PC : `npm install`, `npm run dev`, `npm test`.
