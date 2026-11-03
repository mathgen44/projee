# Développement de Projee

Electron, sans framework : HTML, CSS et JavaScript (modules ES). Node.js 20 ou plus récent.

```bash
npm install
npm start
```

`F12` ouvre les outils de développement de la fenêtre de régie.

## Test automatique

Le test enchaîne les cas importants (démarrage, vidéo prête, GO, pause, fin, enchaînement, NOIR, image figée,
fondu au noir) et capture les deux fenêtres dans `selftest-out/`, avec la luminosité moyenne de la sortie :
elle doit valoir 0 quand le projecteur doit être noir.

```bash
npm run selftest -- --selftest-media=test-media
```

`test-media` doit contenir au moins trois vidéos, par exemple générées avec ffmpeg :

```bash
ffmpeg -f lavfi -i testsrc2=s=1280x720:r=30:d=4 -f lavfi -i sine=f=440:d=4 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest test-media/1-mire.mp4
```

Ajoutez `--selftest-display` pour tester en plein écran sur le second écran plutôt qu'en fenêtre.

Pour tester l'application construite (elle ne peut pas écrire en elle-même), indiquez un dossier de sortie :

```bash
dist/win-unpacked/Projee.exe --selftest --selftest-media=test-media --selftest-out=selftest-out
```
La fenêtre de régie est alors réduite à 1280×700 pour vérifier l'affichage sur un petit écran.

## Construire les installateurs

```bash
npm run dist:win
```

Produit dans `dist/` l'installateur et la version portable Windows.
L'image disque Mac se construit sur un Mac (`npm run dist:mac`) ou, plus simplement, par la publication automatique ci-dessous.

## Publier une version

La publication est automatique (GitHub Actions, `.github/workflows/release.yml`) : Windows et Mac sont
construits sur les machines de GitHub, puis publiés ensemble dans une version. C'est elle que la recherche de
mises à jour de l'application propose aux utilisateurs.

1. Changez `version` dans `package.json` (par exemple `0.2.0`) et commitez.
2. Créez et envoyez l'étiquette correspondante :

```bash
git tag v0.2.0
```

```bash
git push origin main v0.2.0
```

3. Suivez la construction dans l'onglet *Actions* du dépôt. La version n'est publiée que si Windows et Mac ont réussi.

L'application Mac n'est pas signée par Apple : electron-builder lui donne une signature « ad hoc » (`mac.identity: "-"`),
suffisante pour que l'utilisateur l'autorise une fois dans les Réglages Système (voir le README).
Avec un compte développeur Apple (99 $/an), on pourrait la signer et la faire notariser pour supprimer cette étape.

## Édition macOS ancien

Les Mac sous macOS 10.13 (High Sierra) à 11 (Big Sur) ne peuvent pas lancer Electron 38 (macOS 12 minimum).
`electron-builder-legacy.js` reprend la configuration de `package.json` avec Electron 26.6.10, la dernière version
compatible avec High Sierra, en x64 seulement. La publication automatique la construit en même temps que les autres
(`Projee-…-Mac-ancien.dmg`).

Le même code tourne sur les deux versions d'Electron. Ce qui diffère est isolé :

- glisser-déposer : `file.path` (Electron 26) ou `webUtils.getPathForFile` (Electron récent) ;
- mises à jour : `src/main/updates.js` propose l'image disque « ancien » à l'édition construite avec Electron 26.

Avant d'utiliser dans le code une fonction d'Electron ou de Chromium apparue après Electron 26 (Chromium 116, Node 18),
prévoyez une solution de repli, puis faites tourner le test automatique avec Electron 26 :

```bash
npm install --prefix ../electron26 electron@26.6.10
```

```bash
../electron26/node_modules/electron/dist/electron.exe . --selftest --selftest-media=test-media
```

## Icône

```bash
python tools/make_icon.py
```

Génère `src/assets/icon.png` (Pillow nécessaire) ; electron-builder en tire les icônes Windows et Mac.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `src/main/main.js` | Processus principal : fenêtres, écrans, projets, anti-veille |
| `src/main/media-protocol.js` | Protocole `projee-media://` : lecture des vidéos locales (requêtes partielles, CORS pour Web Audio) |
| `src/main/project.js` | Lecture, écriture et export des projets `.projee` |
| `src/main/settings.js` | Réglages de l'application et leur migration |
| `src/main/updates.js` | Recherche d'une nouvelle version sur GitHub |
| `src/renderer/output/` | Fenêtre de sortie : deux lecteurs, fondus, son, fin des vidéos, mire |
| `src/renderer/control/js/engine.js` | Moteur de lecture : GO, vidéo en attente, enchaînements |
| `src/renderer/control/js/main.js` | Interface de régie |
| `src/renderer/control/js/editor.js` | Réglages d'une vidéo, icônes des actions de fin |
| `src/renderer/control/js/selftest.js` | Test automatique |

### Principe de la sortie vidéo

La fenêtre de sortie contient deux lecteurs superposés, invisibles par défaut sur fond noir.
Pendant que l'un est à l'antenne, l'autre prépare la vidéo en attente : il la charge et la cale sur sa première image,
toujours invisible. Au GO, il démarre et ne devient visible qu'une fois la lecture lancée.
La fin des vidéos (retour au noir, image figée, boucle, enchaînement) est gérée dans la fenêtre de sortie elle-même,
toutes les 10 ms, pour tomber pile à l'image.
