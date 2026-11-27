# Lot 3 — Intégrer les sprites générés

Le moteur ne connaît que des **clés visuelles** (`gnome_melee`, `hero_bob`, `acc_goggles`…).
Remplacer un sprite = déposer `public/sprites/<clé>.png` puis lancer :

```bash
npm run sprites -- check     # vérifie dimensions, découpage, animations, noms de fichiers
npm run sprites -- import    # écrit le manifeste (src/render/assets.manifest.json)
```

Aucun code à toucher. Tes fichiers passent avant les sheets de remplacement de
`public/sprites/generated/` (produites par `npm run sprites -- generate` à partir des silhouettes,
dans le même format que les vraies). Une exportation Aseprite `<clé>.json` (« Horizontal strip »,
avec des tags `idle`, `walk`, `attack`, `death`) posée à côté du PNG fixe le découpage et les animations ;
sans elle, les images sont supposées carrées et dans l'ordre standard ci-dessous.

Si une image manque ou ne se lit pas, le jeu affiche la silhouette de secours (`placeholder` de
l'entrée) et le signale dans la console, au lieu de planter.

## Ce qu'il faut générer

| Clé | Quoi | Taille de cellule | Animations |
| --- | --- | --- | --- |
| `gnome_melee`, `gnome_archer`, `gnome_charger` | troupes gnomes | 16 × 16 | idle, walk, attack, death |
| `goblin_melee`, `goblin_archer`, `goblin_charger` | troupes gobelins | 16 × 16 | idle, walk, attack, death |
| `hero_bob`, `hero_kevin`, `hero_gertrude` | héros gnomes | 32 × 32 | idle, walk, attack, death |
| `hero_grok`, `hero_snik`, `hero_morva` | héros gobelins | 32 × 32 | idle, walk, attack, death |
| `acc_goggles`, `acc_sword`, `acc_grenades`, `acc_glue`, `acc_chicken`, `acc_pot` | accessoires d'upgrade, séparés du personnage | ~12 × 12 | aucune |

Nouveaux emplacements (novembre 2026), tous avec un dessin de secours tant qu'aucune image n'est fournie :

| Clé (section du manifeste) | Quoi | État |
| --- | --- | --- |
| `acc_pie`, `acc_umbrella`, `acc_whistle` (`accessories`) | tarte à la crème, parapluie à foudre, sifflet à supporters | placeholder PixelLab dans `sprites/generated/` |
| `boss_crown` (`overlays`) | couronne du mini-boss (3 upgrades et plus) | placeholder PixelLab |
| `boss_aura` (`overlays`) | aura du mini-boss | dessin par code |
| `gag_tophat`, `gag_helmet`, `gag_umbrella`, `gag_flower`, `gag_viking`, `gag_propeller`, `gag_duck` (`overlays`) | accessoires du spectateur récurrent (un par épisode) | dessin par code |
| `fx_crowd_burst` (`overlays`) | éclats du public qui explose | dessin par code |
| `giant_chicken` (`accessories`), `giant_chicken_body` (`effects`) | la poule géante (incident désactivé par défaut) | dessin par code |
| `ui_slot_frame` (`staging.reveal.slot.url`) | cadre de la machine à sous | dessin par code |

Pour une image : `"type": "image", "url": "sprites/...png", "size": <hauteur en px monde>` en gardant `placeholder` en secours.

Règles communes, pour que la nuée reste lisible sur téléphone :

- pixel art 16 bits, fond transparent, **personnage tourné vers la droite** (le moteur retourne l'image) ;
- contour sombre d'un pixel ; les héros ont en plus un léger contour clair ;
- silhouettes distinctes par camp (gnomes ronds à bonnet, gobelins pointus à oreilles), pas seulement des couleurs ;
- une sprite sheet par clé, toutes les images sur **une seule ligne**, dans l'ordre : idle, walk, attack, death.

## Prompts de départ (PixelLab / Retro Diffusion)

- Troupe : `16x16 pixel art garden gnome soldier, red pointy hat, white beard, blue tunic, holding a small sword, side view facing right, 16-bit SNES style, transparent background, dark 1px outline`
- Archer gnome : idem avec `holding a short bow, green hat`.
- Gobelin : `16x16 pixel art goblin warrior, green skin, big pointy ears, brown loincloth, rusty dagger, side view facing right, 16-bit, transparent background, dark 1px outline`
- Héros : passer en `32x32`, ajouter le trait d'archétype (`brave stance, golden helmet` pour Bob, `nervous, purple hat, glasses` pour Kevin…).
- Animations : générer `walk cycle 4 frames`, `attack 3 frames`, `death 4 frames` à partir de l'image de base pour garder le même personnage.
- Accessoires : `12x12 pixel art laser goggles, red lenses, transparent background, side view` — sans personnage, ils sont superposés par le moteur.

Retouche dans Aseprite : vérifier que chaque cellule fait exactement la taille prévue et que les pieds sont au même endroit d'une image à l'autre.

## Entrée de manifeste (écrite par `npm run sprites -- import`)

```json
"gnome_melee": {
  "type": "spritesheet",
  "url": "sprites/gnome_melee.png",
  "frameWidth": 16, "frameHeight": 16,
  "size": 16,
  "animations": {
    "idle":   { "frames": [0, 1],       "fps": 4 },
    "walk":   { "frames": [2, 3, 4, 5], "fps": 10 },
    "attack": { "frames": [6, 7, 8],    "fps": 14 },
    "death":  { "frames": [9, 10, 11, 12], "fps": 10 }
  }
}
```

`size` est la hauteur affichée en px monde (×4 à l'écran) : 16 pour une troupe, 24 à 32 pour un héros.
Les briques d'animation (fente, flash, chute…) restent actives par-dessus ; on peut les couper par entrée avec `"bricks": { "death": "fade" }`.

### Export PixelLab en 8 directions

```bash
npm run sprites -- pixellab "<dossier de l'export>" goblin_melee
```

Le dossier contient `metadata.json`, `rotations/<direction>.png` et `animations/<nom>/<direction>/frame_XXX.png`.
Pour un export à plusieurs variantes (un seul `metadata.json` à la racine, un sous-dossier par variante),
on passe le sous-dossier de la variante : la commande prend sa description dans le `metadata.json` parent.
La commande assemble `public/sprites/<clé>.png` (une ligne par direction : rotation fixe, puis les images
de chaque animation) et `<clé>.directions.json`, puis lance `import`. L'entrée reçoit `"directions": 8` :
le rendu choisit la ligne selon le déplacement, sinon selon la cible, au lieu du miroir gauche/droite.
Noms reconnus : *punch, attack, slash…* → attack ; *kick* → kick (coup de pied, attaque secondaire) ;
*taking punch, hurt…* → hurt (coup encaissé) ; *getting up* → getup (relevé après une projection) ;
*walk, run* → walk ; *death, die* → death.
Une animation absente retombe sur la rotation fixe (walk), sur le coup de poing (kick), ou sur les briques
(death : chute). Pour une direction en double (« west-8062cc6e »), la première variante est prise.

`--hit=attack:5,kick:3` indique l'image de chaque coup où il touche (rang dans l'animation, à partir de 0).
Le rendu règle la cadence pour que cette image tombe pile au moment de l'impact simulé
(`rules.tuning.melee.windup` et `kick.windup` dans battle.json). Sans `--hit`, l'image du milieu.
`size` est calculé pour que le personnage ait la hauteur de sa silhouette ; `--scale=1.25` le grossit
(mémorisé dans `<clé>.directions.json`, donc conservé par `import`).

Plusieurs clés après le dossier partagent le même skin (une copie par clé, remplaçable seule plus tard) :

```bash
npm run sprites -- pixellab "<export gnome>" gnome_melee gnome_archer gnome_charger gnome_mage hero_bob hero_kevin hero_gertrude fan_gnome --scale=1.25
npm run sprites -- pixellab "<export gobelin>" goblin_melee goblin_archer goblin_charger goblin_shaman hero_grok hero_snik hero_morva fan_goblin --scale=1.25
```

Accessoire :

```json
"acc_goggles": { "type": "image", "url": "sprites/acc_goggles.png", "size": 6, "anchor": [0.18, -0.22] }
```

`anchor` place l'accessoire par rapport au centre du héros, en fraction de sa taille (x vers l'avant du regard, y vers le bas).

## Thèmes (mêmes règles, autres assets)

Un thème est un fichier `src/render/themes/<id>.json` choisi dans l'URL : `?theme=noel` (la régie ouverte
avec `?theme=noel` prévisualise aussi dans ce thème). Il ne contient que ce qui change :

- `name` : titre de l'onglet ;
- `teams` : nom et couleurs des deux camps à l'écran (`label`, `main` pour le texte, `bar` pour les jauges) ;
  les identifiants `gnomes` / `goblins` des données et des règles ne changent pas ;
- `manifest` : morceaux de `assets.manifest.json` à remplacer. Les objets sont fusionnés clé par clé, les
  tableaux et valeurs remplacés, `null` retire une entrée (retour au placeholder ou au repli dessiné).

Les images du thème vont dans `public/sprites/themes/<id>/`. Pour un personnage PixelLab :
`npm run sprites -- pixellab <dossier> <clés…> --theme=noel` range la sheet dans ce dossier et écrit son entrée
dans le thème, sans toucher au manifeste de base. Pour une image (sol, titre, cadre…), ajouter son chemin à la main
sous `manifest.art`, `manifest.staging`, etc. Le test `tests/themes.test.ts` vérifie que chaque thème donne un
manifeste valide, ne vise que des clés connues et que ses images existent.

Les textes des données (cris des héros, noms d'unités dans `src/data`) font partie des règles et restent communs.

## Vérifier

1. `npm run dev`, puis `?seed=1&up=bob:laser_goggles` pour voir un héros équipé.
2. Une clé absente ou mal orthographiée affiche un placeholder et un avertissement dans la console.

## Assets PixelLab du lot G (titre, accessoires, sols, effets)

Générés avec l'outil MCP PixelLab `create_image_pixen` (1 génération par appel ; 20 générations au total, retouches comprises).
Paramètres communs sauf mention : `outline: "single color black outline"`, `detail: "medium detail"`, `no_background: true`.
Post-traitement (script du lot, reproductible à la main) : alpha seuillé à 128, recadrage sur la boîte englobante.
Chaque clé a un repli dessiné par code : supprimer le fichier (ou l'entrée) suffit à revenir au dessin d'origine.

| Fichier | Clé de manifeste | Taille gén. / seed | Prompt (résumé) | Notes |
| --- | --- | --- | --- | --- |
| sprites/arena/title.png | `art.title` | 256x128 / 7101 | game title logo text 'GNOMES VS GOBELINS', chunky bold blocky letters, GNOMES blue/red, VS yellow, GOBELINS green, fantasy arcade battle logo | Remplace « 50 GNOMES / vs / 50 GOBELINS » dans `drawOpeningTitle` (reveal.ts), donc aussi sur l'image de boucle de fin ; effectifs affichés dessous (« 50 contre 50 »). Repli : texte. |
| sprites/arena/ground_<biome>.png (sable, foret, neige, volcan) | `art.grounds.<biome>` | 128x128 / 7301-7304 | seamless tileable top-down {desert sand / short grass / packed snow / volcanic ash rock} ground texture, low contrast, flat, no objects ; `no_background: false`, `view: "high top-down"`, `outline: "lineless"`, `detail: "low detail"` | Raccord rendu sans couture (fondu tramé avec la copie décalée d'une demi-tuile), contraste ramené vers la moyenne (x0,3 ; forêt x0,15), 16 couleurs. Répété sur le terrain par arenaArt.ts à la place des mouchetures. Repli : dessin par code. |
| sprites/arena/stands.png | `art.stands` | 64x64 / 3 (`create_image_pro_flash`, style du roi) | seamless tileable colosseum stone bleacher seats seen from above, straight horizontal rows of grey-purple stone steps, flat orthographic | Répété sur tout le fond par arenaArt.ts, en mode « luminosité » sur la couleur des gradins du biome (la pierre prend la teinte du biome). Repli : rangées dessinées. |
| sprites/arena/king.png | `art.king` | 32x32 / 7 (`create_image_pro_flash`) | chubby arena emperor king sitting, front view, big golden crown, purple royal robe with ermine collar, smug grin | Affiché à x0,75 devant le trône (show.ts) ; c'est lui qui tombe dans l'easter egg. Repli : empereur ASCII. |
| sprites/arena/throne.png | `art.throne` | 32x32 / 7 (`create_image_pro_flash`, style du roi) | empty royal throne, red velvet, ornate golden frame with a small crown | Reste en place quand le roi tombe. |
| fx/gas_1.png, fx/gas_2.png | `staging.gas.sprites` | 48x48 / 11, 27 (`create_image_pixflux`) | puff of toxic green poison gas cloud, billowy, lineless | Bouffées du gaz de la zone (gas.ts) : grossissent, tournent, s'effacent. Repli : disques de couleur. |
| sprites/ui/pattern.png | `art.menu.pattern` | 32x32, tuile refaite à partir de `create_image_pro_flash` | seamless repeating pattern of tiny gnome hats and goblin heads on dark purple | Fond des écrans de fin et du rideau de la roulette, pixels x4, défile en diagonale (`art.menu.scroll`, `patternAlpha`). Repli : fond rayé. |
| sprites/ui/card.png | `art.menu.card` | 173x260 (`create_ui_asset`) | ornate golden pixel art card frame, dark purple inside | Cadre unique des écrans de fin (src/render/frame.ts) : cartes de vote, plaques de titre, fenêtres des rouleaux et rideau de la roulette, en 9-slice (bords 20/20/22/22) x1,5. Repli : rectangles. |
| sprites/ui/plaque.png, sprites/ui/plaque_crown.png | `art.menu.plaque`, `art.menu.crown` | 151x88 + 41x18 (`create_ui_asset`, couronne détachée) | golden royal title plaque with a small crown on top | Seule la couronne sert, posée sur le cadre doré des titres (la plaque est remplacée par le cadre des cartes, pour des cadres identiques). |
| sprites/ui/slot_frame.png | `staging.reveal.slot.url` | 32x33 (`create_ui_asset`) | golden slot machine reel frame | Non utilisé : les rouleaux prennent le cadre des cartes (sans card.png, cadre dessiné). |
| generated/acc_goggles.png | `accessories.acc_goggles` | 32x32 / 7211 | pair of round red glass goggles with black rims and black strap | Recadré sur la bande des verres (lignes 11-26). 1er essai (7201) inutilisable. |
| generated/acc_sword.png | `acc_sword` | 32x32 / 7202 | short steel sword pointing up, brown leather hilt, gold crossguard | |
| generated/acc_grenades.png | `acc_grenades` (size 4 -> 4,5) | 32x32 / 7203 | belt of three small round green grenades on a brown leather strap | |
| generated/acc_glue.png | `acc_glue` | 32x32 / 7204 | small glass jar of bright lime green glue with grey metal lid | |
| generated/acc_chicken.png | `acc_chicken` | 32x32 / 7205 | small white chicken with red comb and orange beak, facing right | |
| generated/acc_pot.png | `acc_pot` (size 5 -> 6, ancre y -0,5 -> -0,38) | 32x32 / 7216 | empty grey iron cooking pot with two small handles, no face | Retourné verticalement (casque). 1er essai (7206) dessinait un visage. |
| fx/explosion.png | `effects.explosion.sprite`, `effects.meteor_blast.sprite` | 64x64 / 7401 | cartoon explosion burst, orange yellow fireball with dark smoke puffs | |
| fx/dust.png | `effects.dust.sprite` | 48x48 / 7404 | cartoon dust cloud puff, beige grey round puffs | |
| fx/lightning.png | `effects.lightning.sprite`, `effects.storm_bolt.sprite` (anchor bottom) | 32x64 / 7403 | vertical zigzag lightning bolt, pale blue and white electric | |
| fx/cream_splat.png | `effects.cream_splat.sprite` | 48x48 / 7415, `view: "high top-down"` | flat splash of white whipped cream on the ground, droplets, no pie crust | 1er essai (7405) dessinait une tarte entière. |
| fx/impact.png | (non branché) | 48x48 / 7402 | comic hit impact star burst, white and yellow spiky flash | Livré pour un futur effet d'impact ; brancher via `"sprite": { "url": "sprites/fx/impact.png", "size": 12 }`. |

Schéma (src/render/manifest.ts) : `art` (facultatif, `title`, `grounds`, `stands`, `king`, `throne`, `menu`) et `effects.<clé>.sprite`
(`url`, `size` px monde minimum — un gros rayon d'effet l'agrandit —, `anchor` `center` | `bottom`). L'image d'effet
grossit de 0,6 à 1,1 fois sa taille en s'effaçant (durée = `duration` de l'effet, 250 ms minimum), par-dessus le dessin par code.
Les accessoires restent orientés vers la droite (retournés quand le héros regarde à gauche) et servent aussi d'icônes
dans la machine à sous.
