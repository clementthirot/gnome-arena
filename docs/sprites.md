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
*run* → walk (course) ; *walk* → stroll (marche, au contact) ; *fight stance* → guard (garde à l'arrêt) ;
*death, die* → death.
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

Les règles (`src/data`) restent communes. Un thème peut en plus porter :

- `heroes`, `biome`, `upgrades` : roster, arène et pool d'upgrades votables proposés par défaut
  (`npm run episode -- new-arc --theme noel`, sélecteur « Thème » de la régie) ; l'arc enregistre `theme` et `upgrades` ;
- `labels` : noms affichés des équipements (`equipment.<id>.label/short`), des unités et des incidents. Seul le texte
  à l'écran change, les identifiants et les stats restent ceux des données.

Un arc qui a un `theme` recharge la page dans ce thème (jeu et régie), même sans `?theme=` dans l'URL.

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

## Pack Noël « Calendrier de l'Avent » (thème `noel`)

Brief : doc Claude « Pack Noël — Calendrier de l'Avent ». Même moteur, même équilibrage de base ; tout passe par
`src/render/themes/noel.json` et les ajouts de données (héros `active: false`, upgrades `pack: "noel"`, capacités `innate`).

### Personnages (PixelLab API v2, `create-character-v3`)

Paramètres communs : `view: "low top-down"`, 8 directions, template `mannequin`, `outline: single color black outline`.
Animations par template (1 génération par direction) : `running-6-frames`, `cross-punch`, `falling-back-death`.
Import : `npm run sprites -- pixellab <dossier dézippé>/Idle <clé> --theme=noel --scale=1.25 --hit=attack:3` (invocations : `--scale=1`).
La mort sud-ouest de Mère Noël n'a pas été générée : c'est le miroir de la sud-est (à régénérer si besoin).
Gros Glaçon : `shrinkWithHp: 0.6` (rapetisse avec ses PV) et `rollOnCharge` (roule pendant sa charge).

| Clé | Taille / seed | character_id | Prompt |
| --- | --- | --- | --- |
| hero_marcel | 64 / 4101 | e031cef2-cca1-4972-aedb-9fffa8814663 | Chubby Christmas elf blacksmith, green tunic with red trim, brown leather apron, pointy green elf hat, thick white beard, big rounded nose, holding a huge iron forge hammer |
| hero_mere_noel | 64 / 4102 | 3e73b0ce-8672-4de6-8c32-7b7534b0912f | Mrs. Claus, plump kind grandmother, red velvet dress with white fur trim, white apron, white hair in a bun, small round glasses, holding a giant wooden rolling pin |
| hero_papy_boulon | 64 / 4103 | 2e0f738a-303f-431c-9f51-995593a3e4e1 | Old elf inventor, green overalls with red patches, brass goggles on the forehead, very long white beard, pointy green elf hat, holding a big steel wrench |
| hero_glacon | 64 / 4104 | fdf32248-aa70-4494-b40d-c033b631598c | Evil snowman, round body of dirty grey snow, angry coal eyes, crooked carrot nose, purple scarf, black top hat, twig arms |
| hero_fouettard | 64 / 4105 | 6f624ee2-fb0b-4ed7-a83f-2a6377edb21b | Pere Fouettard, gaunt sinister old man in a charcoal black hooded robe with purple trim, long black beard, big brown sack over the shoulder, bundle of twigs in hand |
| hero_gobbo | 64 / 4106 | 72a1e32a-be84-46f9-b3af-665cae04d4a5 | Green goblin disguised as Santa Claus, dark purple Santa suit with black fur trim, fake white cotton beard askew, big pointy ears, sneaky grin, black boots |
| toy_soldier | 32 / 4107 | 5d6fe650-3ff3-478c-8602-f6ecc19a9c8b | Small wooden toy soldier, red jacket, blue trousers, tall black shako hat, painted rosy cheeks, wind-up key in the back |
| mimic_gift | 32 / 4108 | cb5a79d6-34b3-4f6b-9d07-5973fb4c97e2 | Mimic gift box monster, dark purple wrapped present with black ribbon, open lid with sharp teeth and red tongue, small legs |

Troupes : les sheets du lutin (gnomes) sont reprises telles quelles ; celles du voleur (gobelins) sont recolorées en
violet et noir charbon (décalage de teinte des verts, script de post-traitement du lot), rangées sous
`sprites/themes/noel/gnome_*`, `goblin_*`, `fan_*`.

### Images (`create-image-pixen`, synchrone)

Commun : `no_background: true`, `outline: single color black outline`, `detail: medium detail` sauf mention.

| Fichier (sous `sprites/themes/noel/`) | Clé | Taille / seed | Prompt (résumé) |
| --- | --- | --- | --- |
| acc/star.png | `accessories.acc_goggles` (Étoile de sapin laser) | 32 / 5201 | golden Christmas tree topper star |
| acc/candycane.png | `acc_sword` (Sucre d'orge géant) | 32 / 5202 | giant red and white striped candy cane |
| acc/crackers.png | `acc_grenades` (Pétards de Noël) | 32 / 5203 | bundle of three Christmas crackers |
| acc/marshmallow.png | `acc_glue` (Bombe à guimauve) | 32 / 5204 | glass jar of pink and white marshmallows |
| acc/turkey.png | `acc_chicken` (Lance-dinde) | 32 / 5225 | cooked roast turkey, no face (essais précédents avec un visage écartés) |
| acc/sweater.png | `acc_pot` (Pull de Noël moche) | 32 / 5206 | ugly Christmas sweater, green knit with red reindeer |
| acc/snowball.png | `acc_snowball` (Boule à neige géante) | 32 / 5207 | big round snowball |
| acc/bells.png | `acc_bells` (Grelots du traîneau) | 32 / 5208 | two golden jingle sleigh bells on a red strap |
| ui/gift_box.png | `art.menu.gift` | 64 / 5209 | closed Christmas gift box, red paper, gold ribbon |
| ui/card.png | `art.menu.card` (slice 18/19/20/17) | 128 / 5304 | gingerbread cookie frame, white icing, flat dark chocolate inside |
| ui/pattern.png | `art.menu.pattern` | dessiné (PIL) | papier cadeau rayé rouge et blanc (la tuile PixelLab ne raccordait pas) |
| arena/stands.png | `art.stands` | dessiné (PIL) | gradins en pain d'épice glacé (idem) |
| fx/trap_bauble.png | `effects.meteor.sprite` (Boule piégée) | 32 / 5210 | dark purple bauble with a lit fuse |
| fx/skin_gingerbread.png, fx/skin_coal.png | `overlays.skin_*` | 16 / 5211, 5212 | bonhomme de pain d'épice, morceau de charbon |
| fx/poof.png | `effects.poof_*` | 48 / 5233, lineless | white and pale pink smoke puff |
| fx/rolling_pin.png | `effects.rolling_pin`, `snowball_roll` | 32 / 5401 | giant wooden rolling pin |
| fx/coal_sack.png | `effects.sack_spit` | 32 / 5402 | big brown burlap sack |

Sol : `sprites/arena/ground_neige.png` du lot G. Chute de neige : ambiance du biome `noel`.
Tempête : `staging.gas.style: "blizzard"` (dans `noel.json`) remplace le gaz par `src/render/storm.ts` : neige
cinglante poussée par un vent à rafales, grêlons qui tombent en biais et éclatent au sol, nuages de rafale, ciel
assombri hors zone (`staging.gas.shade`) et congère le long de la limite. Rendu seulement, les dégâts restent ceux du moteur.
Depuis le 28/11/2026 : le ciel bouché et la congère sont peints sous le public et les unités (les sprites passent
par-dessus la limite), la tempête souffle aussi sur les gradins, monte en ~18 s jusqu'à devenir intense et retombe
en quelques secondes quand le combat est fini. Un mort resté `staging.gas.freeze.after` secondes (4) dans la
tempête bleuit puis gèle dans un bloc de glace :

| Fichier | Clé | Taille / seed | Prompt |
| --- | --- | --- | --- |
| sprites/themes/noel/fx/ice_block.png | `staging.gas.freeze.sprite` | 48 / 6101 (`create-image-pixen`, `view: low top-down`, sans fond ; 3 essais 6101-6103) | block of clear pale blue ice lying flat on the ground, jagged frozen icicles on top, frosty white highlights, translucent glassy ice, empty inside |

Posé à 80 % d'opacité sur le corps teinté bleu glacier (on devine le mort dedans). Sans l'image, le corps bleuit seulement.

## Allures : marche et garde de combat (PixelLab, 28/11/2026)

Le rendu choisit l'allure de chaque unité au sol (`playGait` dans ArenaScene.ts) :
`walk` (course) quand elle fonce, `stroll` (marche) quand elle avance lentement ou se replace au contact,
`guard` (garde en boucle) à l'arrêt face à un adversaire, `idle` (pose fixe) sinon. La cadence suit la vitesse
réelle. Sans `stroll`, la course est jouée ralentie ; sans `guard`, la pose fixe. Seules `idle`, `guard`, `stroll`
et `walk` bouclent : coups, coup de pied, blessure, relevé et mort ne jouent qu'une fois, et un coup cède à la
course dès l'image d'impact passée si l'unité repart.

Générées par l'API v2 (`POST /characters/animations`, mode template, 1 génération par direction) sur les
personnages existants, puis ajoutées en colonnes à droite des sheets (centrées dans l'image, sans
ré-assembler le reste) :

| Personnage (character_id) | Sheets | Templates |
| --- | --- | --- |
| gnome de base 78b1b8f0-4f53-432b-9e8a-0615c13c0226 | gnome_*, fan_gnome | `walking-6-frames` → stroll, `fight-stance-idle-8-frames` → guard |
| gobelin de base 7c57e856-1348-4d26-82ea-2bd621a89ae7 | goblin_*, fan_goblin, hero_grok/snik/morva | idem |
| lutin ea8c68d0-591e-433b-9c47-82ddaf2a34d4 | themes/noel/gnome_*, fan_gnome | idem |
| voleur 407a3794-6160-4067-91c2-7bdc9d0b9cfe | themes/noel/goblin_*, fan_goblin (recolorés : rouge → violet, jaune → orange) | idem |
| héros Noël, soldat, cadeau mimic (ids ci-dessus) | themes/noel/hero_*, toy_soldier, mimic_gift | idem |

Les héros de base Bob, Kevin et Gertrude n'ont pas de personnage PixelLab sur le compte : ils gardent la course,
jouée ralentie au contact.
