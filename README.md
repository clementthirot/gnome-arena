# Gnomes vs Gobelins — l'arène feuilleton

Une mêlée autonome de 2 × 50 unités au format vertical 9:16, avec des héros nommés, des upgrades
votées par le public et des incidents d'arène. Les personnages sont des sprite sheets animées de
remplacement, générées à partir de silhouettes, en attendant les sprites PixelLab
(voir [docs/sprites.md](docs/sprites.md) : `npm run sprites -- check` puis `import`).

Les réglages fins du comportement (variations aléatoires, distances des tireurs, charge, fuite,
murs, cadence des incidents…) sont dans `src/data/battle.json` (`rules.tuning` et `events`).

## Lancer

```bash
npm install
npm run dev          # http://localhost:5173 ouvre la régie ; l'arène seule : http://localhost:5173/?seed=1
npm test             # déterminisme, données, mêlée vivante, durée, effets, arcs
npm run bench        # mode accéléré sans rendu (100 seeds)
npm run episode      # état de l'arc en cours
npm run sprites      # vérifie les sprite sheets de public/sprites
```

### Dans le navigateur

| URL | Effet |
| --- | --- |
| `?seed=53` | rejoue exactement le combat 53 |
| `?arc=arc1&ep=3` | épisode 3 de l'arc : sa seed, ses héros, leurs upgrades, et la carte de vote en fin |
| `?record=1` | un clic lance l'enregistrement (vidéo 1080 × 1920 avec le son, webm), téléchargé à la fin de l'écran de vote |
| `?biome=neige` | biome de l'arène : `sable`, `foret`, `neige` (glissante), `volcan` |
| `?up=bob:magic_sword+grenades,snik:laser_goggles` | équipe des héros à la main (essais) |
| `?speed=4` | affichage accéléré |
| `?theme=noel` | thème visuel (mêmes règles, autres assets) : voir docs/sprites.md, « Thèmes » |
| `?prev=kevin:laser_goggles:120,340,95` | simule le vote de l'épisode précédent (héros, upgrade gagnante, voix) pour voir la révélation d'ouverture sans arc |
| `?safe=1` | dessine les zones couvertes par l'interface TikTok / Reels / Shorts (voir `src/render/safeZone.ts`) |
| `?eggs=1` | force les easter eggs (public qui explose, ola, empereur qui tombe…) pour les vérifier |
| `?mode=bench&runs=100&from=1` | mode accéléré dans un Web Worker, avec liens « voir » et « enregistrer » vers les meilleures seeds |

Pendant un combat : `Espace` pause, `1` `2` `4` `8` vitesse, `M` couper le son
(le son démarre au premier clic ou à la première touche, règle des navigateurs).
Pendant un enregistrement, garder l'onglet visible : un onglet caché n'affiche plus d'images.

## Régie

`http://localhost:5173/regie.html` (serveur de dev lancé) prépare un épisode sans ligne de commande, avec l'arène toujours visible à droite
(séparation à glisser, ou boutons 2/3, 3/4, 4/5). L'aperçu suit le formulaire en direct : réglages, seed choisie,
héros et options de vote, même avant d'enregistrer (case « sans intro » pour aller vite).


1. **Prochain épisode** : lancer le scout (Web Worker), cliquer une seed dans le tableau. Les seeds qui
   finissent comme l'épisode précédent (retournement, héros seul contre tous, écrasement…) sont pénalisées.
2. Choisir le héros du camp perdant qui recevra l'upgrade (le moins équipé est proposé) et les 3 options.
3. **Aperçu** ouvre le combat ; **Figer l'épisode** l'écrit dans l'arc et ouvre la page d'enregistrement.
4. Après publication, saisir les voix ou coller un export de commentaires, puis valider.
5. **Réglages de l'arc** : biome, effectifs par camp, incidents par minute et poids de chaque incident,
   probabilités des gags. Ils s'appliquent au prochain épisode ; chaque épisode figé garde sa copie, donc les
   épisodes publiés restent rejouables à l'identique.
6. **Fin d'arc** : clore l'arc, en créer un nouveau (héros, biome).

Les fichiers d'arc sont lus et écrits par un petit relais du serveur Vite (`vite.config.ts`), qui les valide avant d'écrire.

## Boucle d'un épisode en ligne de commande

```bash
npm run episode -- scout                 # 1. simule 100 seeds avec l'état actuel des héros, classe les plus spectaculaires
npm run episode -- plan --seed 3047      # 2. fige l'épisode : vainqueur vérifié, héros perdant qui recevra l'upgrade, 3 options
                                         #    (--recipient kevin --options laser_goggles,magic_sword,grenades pour choisir)
# 3. ouvrir l'URL affichée avec &record=1 : la vidéo se télécharge à la fin de la carte de vote
# 4. publier, laisser voter en commentaire
npm run episode -- vote --votes 120,340,95          # 5a. saisir les comptes
npm run episode -- vote --comments export.txt       # 5b. ou compter un export de commentaires (une voix par auteur)
npm run episode -- unvote               # annule le dernier vote compté (tant que l'épisode suivant n'est pas figé)
npm run episode -- status                # état des héros, rapport de force, alerte si l'arc devient prévisible
npm run episode -- close                 # fin d'arc ; new-arc --id arc2 pour la suite
```

Les 3 options sont tirées au sort de façon déterministe (`proposeOptions` dans `src/data/arc.ts`), parmi les upgrades que
le héros n'a pas encore et qui conviennent à son rôle (`roles` dans `equipment.json`) ; s'il n'en reste que 2, on en propose 2.
Le héros suggéré est le moins équipé du camp perdant (un héros saturé est exclu). Un vote 0/0/0 est refusé ; à égalité de voix,
le plus petit numéro gagne. Un match nul ne donne pas d'upgrade : choisir une autre seed.

Dans la vidéo de l'épisode N, l'ouverture révèle le vote de l'épisode N-1 (machine à sous qui s'arrête sur l'upgrade gagnante,
pourcentage des voix, l'accessoire qui vole jusqu'au héros, étiquette « NOUVEAU »), puis le combat démarre vers 4 s.
La fin montre le vainqueur et le MVP, puis la carte de vote seule, dans la zone sûre, et se fond dans la première image
pour boucler. L'ancienne intro longue reste disponible avec `staging.intro: "classic"` dans le manifeste.

Les arcs sont des fichiers JSON dans `src/data/arcs/` : l'état des héros à l'épisode N se reconstruit à
partir des votes précédents, donc chaque épisode publié reste rejouable à l'identique.

### Pack Noël « Calendrier de l'Avent »

Lutins contre Vilains, mêmes règles : six héros propres au pack (Marcel l'Enclume, Mère Noël, Papy Boulon contre
Gros Glaçon, Père Fouettard, Gobbo Claus), upgrades rhabillées et deux nouvelles (Boule à neige géante, Grelots du
traîneau), arène enneigée, cadeaux qui s'ouvrent à la place des rouleaux. Gnomes contre Gobelins reste l'arc par défaut.

```bash
npm run episode -- close                                  # un seul arc ouvert à la fois
npm run episode -- new-arc --id noel --theme noel         # roster, biome et pool d'upgrades du thème
npm run bench -- --heroes marcel,mere_noel,papy_boulon,glacon,fouettard,gobbo   # équilibre du pack
```

Aperçu sans arc : `?theme=noel`. Détails des assets et prompts : `docs/sprites.md`.

### Mode accéléré en ligne de commande

```bash
npm run bench -- --runs 200 --from 1 --top 10
npm run bench -- --set battle.rules.damageScale=0.3 --set units.gnome_archer.damage=9
npm run bench -- --up grok:laser_goggles          # poids d'une upgrade sur le rapport de force
npm run bench -- --biome neige                    # un autre biome
```

`--set` teste un réglage sans modifier les JSON (les éléments de tableau sont désignés par leur `id`).

## Organisation

| Dossier | Rôle | Règle |
| --- | --- | --- |
| `src/data` | JSON + schémas Zod, arcs | toute donnée est validée avant usage |
| `src/sim` | moteur : pas fixe 30 Hz, seed, ciblage, recul, rôles, moral, effets, incidents, zone | pas de Phaser, pas de `Math.random`, pas de `Math.sin/cos/hypot/pow` (voir `detmath.ts`) |
| `src/render` | scènes Phaser, manifeste d'assets, placeholders, briques d'animation, effets visuels | lit le moteur, ne change pas les règles |
| `src/capture` | enregistrement vidéo du canvas | — |
| `src/tools`, `scripts` | mesures, mode accéléré, worker, CLI des épisodes | — |
| `tests` | Vitest | — |

Le moteur n'utilise que des opérations exactement arrondies partout : une seed mesurée en ligne de
commande donne le même combat dans Chrome, Firefox ou Safari.

## Ajouter du contenu (JSON uniquement)

- **Une unité** : `src/data/units.json`, son effectif dans `battle.json > armies`, sa clé visuelle dans le manifeste.
- **Un héros** : `src/data/heroes.json` (unité de base, personnalité fixe, multiplicateurs), puis l'ajouter à l'arc.
- **Un équipement** : `src/data/equipment.json` — stats, attaque spéciale composée d'effets, raté éventuel (`misfire` : allié, soi-même ou au hasard) — et son accessoire dans `manifest.accessories`.
- **Un incident d'arène** : `src/data/events.json` — poids, moment d'apparition, cible (`densest`, `hero`, `random_unit`, `random_point`), télégraphe, effets.
- **Un rendu d'effet** : `manifest.effects` (trait, boule, anneau, flaque, éclair, étincelles).
- **Une capacité propre à un héros** : un équipement `"innate": true` listé dans `heroes[].upgrades` (jamais votable, pas d'accessoire).
  `"roleSpell": false` sur le héros retire le sort de son rôle de base quand ses capacités le remplacent.
- **Un pack de thème** : héros `"active": false`, upgrades `"pack": "<id>"` (hors du pool de base), puis
  `src/render/themes/<id>.json` (roster, biome, pool, libellés, assets). Voir `docs/sprites.md`, section Thèmes.

Effets disponibles : `damage` (ponctuel ou de zone, tir allié possible), `projectile` (contient d'autres effets à l'impact,
peut tomber du ciel avec `fromSky`), `ricochet` (rebonds en chaîne), `beam` (rayon qui traverse l'arène et rebondit sur les murs),
`launch` (projette dans les airs), `spawn` (renforts qui sautent des gradins, ou invocations autour du lanceur avec `"from": "source"`),
`transform` (change les unités les plus proches en objet inerte pendant `duration`, jamais les héros par défaut), `knockback`, `slow`.
Les effets de zone peuvent se centrer sur le lanceur (`"at": "self"`, le tourbillon de l'épée) et un rayon peut se charger avant de frapper (`delay`). Une boule de feu = un `projectile` qui déclenche un `damage` de zone.

## Mécaniques

- **Machine à états** : choisir une cible → se rapprocher → attaquer, fuir (panique), mort.
- **Recul** à chaque coup, divisé par la masse ; les charges projettent les voisins.
- **Attaquants limités** par cible ; une unité bloquée derrière la foule change de cible.
- **Rôles** : fantassin, archer (garde ses distances, se bat s'il est acculé), chargeur, tirailleur.
- **Personnalités** : tendances probabilistes ; les héros gardent la leur d'un combat à l'autre.
- **Moral** : panique et fuite sous le seuil, poursuites.
- **Rage du camp mené** (`rules.underdog`) : garde des retournements possibles.
- **Incidents** : météore qui tombe du ciel et projette tout le monde, chute de roche sur la mêlée, boule de feu, éclair en chaîne sur un héros, flaque de boue ; plus fréquents quand l'arène rétrécit.
- **Unités en l'air** : projetées par un météore, une charge ou un K.O. aérien, elles volent loin, ne combattent plus pendant le vol et restent étourdies à l'atterrissage. Les héros vaincus s'envolent toujours, les troupes de temps en temps (`rules.tuning.koLaunch`).
- **Rebonds** : un gros recul fait sauter l'unité, qui rebondit au sol tant qu'elle retombe vite (`rules.tuning.bounce`).
- **Supporters** : de temps en temps, des spectateurs sautent le muret et rejoignent un camp, ou le camp mené (jusqu'à 58 s).
- **Fin maîtrisée** : un gaz toxique sort des conduits et resserre l'arène de 23 s à 39 s ; victoire aux PV restants à 48 s (combat d'environ 40 s, une minute avec l'intro et la fin).

## Gags (moteur, rares, probabilité et plafond par combat dans `battle.json > gags`)

- **Bowling** (permanent) : une unité qui retombe repousse et étourdit ceux sur qui elle tombe.
- **Choc de têtes** : deux chargeurs qui se percutent restent assommés (« BONK ! »).
- **Victoire prématurée** : une unité à l'écart danse après un K.O., jusqu'au prochain coup.
- **Arme perdue** : l'arme s'envole, l'unité court la ramasser.
- **Le public lance** des tomates, des chaussures et des bombes (incidents d'arène, effet `stun`).

## Unités spéciales et déploiement (0 par défaut)

- Rôle **lanceur de sorts** symétrique (mage gnome, sorcier gobelin) : le sort est une liste d'effets en JSON.
- `battle.json > deployment` : réserve qui entre en seconde vague, troupes qui contournent par les flancs.
  Option de test : activées ensemble (30 %), elles déséquilibrent (65/35), parce que la réserve retient d'abord les tireurs.
- `src/data/biomes.json` : décor, ambiance (feuilles, neige, braises), glisse, poids des incidents.

## Mise en scène (rendu uniquement, réglable dans `manifest.staging`)

- **Même seed = même vidéo** : le hasard du rendu (débris, objets perdus, gags visuels) est tiré de la seed (`render/random.ts`).
- **Intro** : fanfare, titre qui tombe en rebondissant, « Épisode N », héros, prono « Qui va gagner ? », 3-2-1 COMBAT.
- **Empereur** dans sa loge : lance le combat, porte les annonces du commentateur (premier sang, triple K.O.,
  héros en feu, retournement), pouce levé vers le vainqueur, présente la roulette des upgrades.
- **Répliques des héros** en bulles selon leur personnalité (`heroes.json > quotes`), carton **DUEL** entre rivaux (`rival`).
- **Juice** : arrêt sur image aux gros impacts, étirement au décollage, étoiles au-dessus des étourdis, sueur des fuyards,
  débris (dents, mottes), bonnets et casques perdus, flèches plantées, flaques qui sèchent et virent au brun.
- **Barre de rapport de force** en haut de l'écran (PV restants de chaque camp).
- **Fin** : ralenti sur le dernier K.O., l'arène continue de vivre, bannières, confettis, spectateur récurrent au chapeau jaune
  qui finit toujours touché ; carte de vote avec portrait, rouleaux façon machine à sous, K.O. cumulés de l'arc, raté de l'épisode.
- **Son** synthétisé (WebAudio) : jingle, compte à rebours, boucle musicale, coups, explosions, laser, public.

- **Présentation des héros** avant « COMBAT ! » : nom, surnom, upgrades portées.
- **Caméra** : zoom bref sur un héros qui tombe, un duel de héros gagné, un tir raté, et suivi continu d'un héros seul contre trois ennemis ou plus. L'interface reste fixe (seconde caméra). Les charges de héros sont désactivées par défaut (`triggers.heroCharge`).
- **Public touché** : flèches ratées, explosions au bord et rayons qui finissent dans le muret atteignent les spectateurs.
- **Gaz** : bouffées vertes crachées par 8 conduits dans les murets (`staging.gas`).
- **Morts trash** : gouttes de sang aux coups, petite flaque sous chaque corps (`staging.gore`, désactivable).
