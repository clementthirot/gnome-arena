# Lot 3 — Intégrer les sprites générés

Le moteur ne connaît que des **clés visuelles** (`gnome_melee`, `hero_bob`, `acc_goggles`…).
Remplacer un placeholder par un vrai sprite = déposer le fichier dans `public/sprites/` et
modifier une entrée de `src/render/assets.manifest.json`. Aucun code à toucher.

## Ce qu'il faut générer

| Clé | Quoi | Taille de cellule | Animations |
| --- | --- | --- | --- |
| `gnome_melee`, `gnome_archer`, `gnome_charger` | troupes gnomes | 16 × 16 | idle, walk, attack, death |
| `goblin_melee`, `goblin_archer`, `goblin_charger` | troupes gobelins | 16 × 16 | idle, walk, attack, death |
| `hero_bob`, `hero_kevin`, `hero_gertrude` | héros gnomes | 32 × 32 | idle, walk, attack, death |
| `hero_grok`, `hero_snik`, `hero_morva` | héros gobelins | 32 × 32 | idle, walk, attack, death |
| `acc_goggles`, `acc_sword`, `acc_grenades`, `acc_glue`, `acc_chicken`, `acc_pot` | accessoires d'upgrade, séparés du personnage | ~12 × 12 | aucune |

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

## Entrée de manifeste

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

Accessoire :

```json
"acc_goggles": { "type": "image", "url": "sprites/acc_goggles.png", "size": 6, "anchor": [0.18, -0.22] }
```

`anchor` place l'accessoire par rapport au centre du héros, en fraction de sa taille (x vers l'avant du regard, y vers le bas).

## Vérifier

1. `npm run dev`, puis `?seed=1&up=bob:laser_goggles` pour voir un héros équipé.
2. Une clé absente ou mal orthographiée affiche un placeholder et un avertissement dans la console.
