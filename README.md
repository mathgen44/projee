# Projee

Lecteur vidéo pour le **spectacle**, sur PC (Windows) et Mac.
Une fenêtre de régie sur l'écran de l'ordinateur, une sortie plein écran sur le projecteur.

**Le projecteur ne montre que du noir** tant qu'aucune vidéo n'est lancée : pas de bouton, pas de curseur,
pas de première image. Chaque lecture part du noir et revient au noir, en lecture seule comme en playlist.

De la même famille que [Jinglee](https://github.com/mathgen44/jinglee), le lecteur de jingles.

## Fonctionnalités

### En spectacle

- **Conduite** avec un grand bouton **GO** : la vidéo en attente est surlignée, avec ses notes de régie.
  Elle est préparée à l'avance (calée sur sa première image, invisible) pour un départ instantané.
- **Lecture seule** (un GO par vidéo) ou **Playlist** (toute la liste s'enchaîne, avec un noir réglable entre deux vidéos).
- **Fondus** depuis le noir et vers le noir, image et son ensemble (0,5 s par défaut, réglables vidéo par vidéo, 0 = coupe franche).
- **Pause** (l'image reste figée, ou passe au noir selon le réglage), **Stop** (fondu court),
  **Fondu au noir** (fondu long), **NOIR** (coupure immédiate de l'image et du son).
- **Retour vidéo** : la régie montre ce qui passe sur le projecteur, avec le temps écoulé, le **temps restant en grand**,
  une barre de progression cliquable et un vumètre.
- **Choix de l'écran** de sortie et de la **sortie son** (carte son, HDMI du projecteur…), mémorisés.
  Si le projecteur est débranché, la sortie l'attend et revient d'elle-même au rebranchement.
- **Mire** pour vérifier le bon écran et le cadrage avant le spectacle.
- **Verrouillage** du mode spectacle (cadenas) : plus aucune modification possible par erreur.
- Horloge, chronomètre, anti-veille de l'ordinateur.

### Réglages de chaque vidéo

- Nom, **début et fin** (pour couper sans retoucher le fichier), volume (0 à 200 %).
- Fondus d'entrée et de sortie propres.
- **À la fin** : retour au noir (par défaut), figer la dernière image, boucle (fond d'attente jusqu'au GO suivant),
  ou enchaîner sur la suivante sans passer par le noir.
- Cadrage : adapter avec bandes noires, remplir l'écran, ou étirer.
- Notes de régie.

### Préparation

- Ajout par glisser-déposer ou bouton **+ Vidéos** ; réorganisation par glisser-déposer ; **lignes de texte** (repères, répliques) que GO saute.
- Chaque vidéo est **testée dès l'import** : un format que l'ordinateur ne sait pas lire est signalé tout de suite.
- **Projets** `.projee` ; vidéos retrouvées par chemin absolu ou relatif au projet.
  Fichiers déplacés : **Relier…** retrouve une vidéo, et les autres du même dossier avec elle.
- **Exporter avec les vidéos** : copie le projet et toutes ses vidéos dans un dossier, à emporter sur une clé USB ou un autre ordinateur.

## Raccourcis clavier

| Touche | Action |
|---|---|
| `Espace` ou `Page suivante` | GO |
| `P` | Pause / reprise |
| `S` | Stop (fondu court) |
| `Échap` | Fondu au noir |
| `Maj+Échap` ou `B` | NOIR immédiat |
| `↑` `↓` ou `Page précédente` | Choisir la vidéo en attente |
| Double-clic sur une vidéo | La lancer tout de suite |
| `Ctrl+S` / `Ctrl+O` (`⌘` sur Mac) | Enregistrer / ouvrir |

Une pédale ou une télécommande de présentation qui envoie `Espace` ou `Page suivante` déclenche le GO.

## Formats vidéo

Conseillés : **MP4 en H.264** (le plus sûr partout), MP4 en HEVC/H.265 (selon la carte graphique), WebM (VP9, AV1).
Non pris en charge : ProRes, DNxHD, la plupart des AVI. Convertissez-les par exemple avec HandBrake (préréglage « Fast 1080p30 »).

## Conseils pour le spectacle

- Branchez le projecteur en mode **Étendre** (Windows : touche Windows + P), pas en mode Dupliquer.
- Sur Mac : *Réglages Système → Bureau et Dock* → activez **« Les écrans disposent d'espaces distincts »**.
- Activez **Ne pas déranger** pour qu'aucune notification n'apparaisse.
- Avant le public : **Mire** pour vérifier l'écran, puis **verrouillage**.
- Testez la conduite sur l'ordinateur du spectacle lui-même : les formats lisibles dépendent de la machine.

## Développement

Electron, sans framework : HTML, CSS et JavaScript (modules ES).

```bash
npm install
npm start
```

`F12` ouvre les outils de développement de la régie.

Test automatique (deux fenêtres capturées dans `selftest-out/`, avec la luminosité moyenne de la sortie
pour vérifier qu'elle est noire quand elle doit l'être) :

```bash
npm run selftest -- --selftest-media=test-media
```

Ajoutez `--selftest-display` pour tester sur le second écran en plein écran plutôt qu'en fenêtre.

Installateurs :

```bash
npm run dist:win
```

```bash
npm run dist:mac
```

L'installateur Mac (`.dmg`, universel Intel + Apple Silicon) doit être construit sur un Mac.
Sans signature Apple, au premier lancement : clic droit sur Projee → *Ouvrir*.

| Fichier | Rôle |
|---|---|
| `src/main/main.js` | Processus principal : fenêtres, écrans, projets, anti-veille |
| `src/main/media-protocol.js` | Protocole `projee-media://` : lecture des vidéos locales |
| `src/main/project.js` | Lecture, écriture et export des projets `.projee` |
| `src/main/settings.js` | Réglages de l'application |
| `src/renderer/output/` | Fenêtre de sortie : deux lecteurs, fondus, son, fin des vidéos, mire |
| `src/renderer/control/js/engine.js` | Moteur de lecture : GO, vidéo en attente, enchaînements |
| `src/renderer/control/js/main.js` | Interface de régie |
| `src/renderer/control/js/editor.js` | Réglages d'une vidéo |
| `src/renderer/control/js/selftest.js` | Test automatique |

## Licence

MIT
