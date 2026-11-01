# Gnomes vs Gobelins — l'arène feuilleton

Une mêlée autonome de 2 × 50 unités au format vertical 9:16, avec des héros nommés, des upgrades
votées par le public et des incidents d'arène. Les formes sont des placeholders générés en attendant
les sprites (voir [docs/sprites.md](docs/sprites.md)).

## Lancer

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # déterminisme, données, mêlée vivante, durée, effets, arcs
npm run bench        # mode accéléré sans rendu (100 seeds)
npm run episode      # état de l'arc en cours
```

### Dans le navigateur

| URL | Effet |
| --- | --- |
| `?seed=53` | rejoue exactement le combat 53 |
| `?arc=arc1&ep=3` | épisode 3 de l'arc : sa seed, ses héros, leurs upgrades, et la carte de vote en fin |
| `?record=1` | enregistre la vidéo 1080 × 1920 et la télécharge à la fin de l'écran de vote |
| `?up=bob:magic_sword+grenades,snik:laser_goggles` | équipe des héros à la main (essais) |
| `?speed=4` | affichage accéléré |
| `?mode=bench&runs=100&from=1` | mode accéléré dans un Web Worker, avec liens « voir » et « enregistrer » vers les meilleures seeds |

Pendant un combat : `Espace` pause, `1` `2` `4` `8` vitesse, `R` rejouer, `N` seed suivante.
Pendant un enregistrement, garder l'onglet visible : un onglet caché n'affiche plus d'images.

## Boucle d'un épisode

```bash
npm run episode -- scout                 # 1. simule 100 seeds avec l'état actuel des héros, classe les plus spectaculaires
npm run episode -- plan --seed 3047      # 2. fige l'épisode : vainqueur vérifié, héros perdant qui recevra l'upgrade, 3 options
                                         #    (--recipient kevin --options laser_goggles,magic_sword,grenades pour choisir)
# 3. ouvrir l'URL affichée avec &record=1 : la vidéo se télécharge à la fin de la carte de vote
# 4. publier, laisser voter en commentaire
npm run episode -- vote --votes 120,340,95          # 5a. saisir les comptes
npm run episode -- vote --comments export.txt       # 5b. ou compter un export de commentaires (une voix par auteur)
npm run episode -- status                # état des héros, rapport de force, alerte si l'arc devient prévisible
npm run episode -- close                 # fin d'arc ; new-arc --id arc2 pour la suite
```

Les arcs sont des fichiers JSON dans `src/data/arcs/` : l'état des héros à l'épisode N se reconstruit à
partir des votes précédents, donc chaque épisode publié reste rejouable à l'identique.

### Mode accéléré en ligne de commande

```bash
npm run bench -- --runs 200 --from 1 --top 10
npm run bench -- --set battle.rules.damageScale=0.3 --set units.gnome_archer.damage=9
npm run bench -- --up grok:laser_goggles          # poids d'une upgrade sur le rapport de force
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

Effets disponibles : `damage` (ponctuel ou de zone, tir allié possible), `projectile` (contient d'autres effets à l'impact),
`ricochet` (rebonds en chaîne), `knockback`, `slow`. Une boule de feu = un `projectile` qui déclenche un `damage` de zone.

## Mécaniques

- **Machine à états** : choisir une cible → se rapprocher → attaquer, fuir (panique), mort.
- **Recul** à chaque coup, divisé par la masse ; les charges projettent les voisins.
- **Attaquants limités** par cible ; une unité bloquée derrière la foule change de cible.
- **Rôles** : fantassin, archer (garde ses distances, se bat s'il est acculé), chargeur, tirailleur.
- **Personnalités** : tendances probabilistes ; les héros gardent la leur d'un combat à l'autre.
- **Moral** : panique et fuite sous le seuil, poursuites.
- **Rage du camp mené** (`rules.underdog`) : garde des retournements possibles.
- **Incidents** : chute de roche sur la mêlée, boule de feu, éclair en chaîne sur un héros, flaque de boue ; plus fréquents quand l'arène rétrécit.
- **Fin maîtrisée** : l'arène rétrécit de 45 s à 75 s, victoire aux PV restants à 80 s.
