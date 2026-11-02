# Gnomes vs Gobelins — dossier de brainstorm

> **Mode d'emploi.** Ce fichier sert de point de départ à une session de brainstorm avec un agent
> conversationnel. Donne-le-lui en entier : il résume le projet, ce qui est fait, les chiffres
> actuels et les décisions en attente. À la fin de la session, remplis la section
> **« Prochaines directives »** ; elle servira de brief au prochain lot de développement.
>
> Note pour l'agent de brainstorm : le code n'est pas joint. Ce document fait foi sur l'état du
> projet au 2 novembre 2026. Propose des options et leurs compromis plutôt que des solutions techniques détaillées.

---

## 1. Le projet en bref

Une arène en pixel art, au format vertical 9:16, où une armée de gnomes affronte une armée de gobelins.
Au milieu de la nuée, quelques héros nommés (Bob, Kevin…) deviennent les stars d'un feuilleton
publié sur TikTok et YouTube Shorts.

- Chaque épisode est un combat autonome d'environ 70 s, sans contrôle joueur.
- Le public vote en commentaire pour l'upgrade loufoque qu'un héros **du camp perdant** recevra
  à l'épisode suivant (lunettes laser, épée magique, grenades…).
- Les héros gardent leurs upgrades d'un épisode à l'autre. Quand les combats deviennent
  prévisibles, l'arc se clôt et un nouveau commence.
- À terme, l'objectif est un petit revenu via la monétisation des plateformes.

Stack : TypeScript, Phaser 3, Vite. Le moteur de combat est séparé du rendu et déterministe :
même seed + même état des héros = même combat, à l'identique, en ligne de commande comme dans
n'importe quel navigateur.

---

## 2. Ce qui est fait

### Combat (moteur)
- 2 × 50 unités : 47 troupes et 3 héros par camp.
- Rôles : fantassin, archer (garde ses distances, recule, se bat s'il est acculé), chargeur
  (fonce et projette les autres), tirailleur (tire pendant l'approche puis frappe au contact).
- Personnalités, qui sont des tendances et non des règles : ordinaire, peureux, téméraire,
  vaillant, prudent, fourbe. Les héros gardent la même d'un combat à l'autre.
- Recul à chaque coup, nombre d'attaquants limité par cible, changements de cible, moral,
  panique, fuite et poursuites.
- « Rage du camp mené » : le camp en retard frappe plus fort, pour garder des retournements possibles.
- Fin maîtrisée : l'arène rétrécit de 45 s à 75 s ; à 80 s, le camp qui a le plus de PV gagne.

### Héros actuels
| Camp | Héros | Archétype | Base |
| --- | --- | --- | --- |
| Gnomes | Bob | le vaillant | chargeur |
| Gnomes | Kevin | le prudent | archer |
| Gnomes | Gertrude | la téméraire | fantassin |
| Gobelins | Grok | la brute | chargeur |
| Gobelins | Snik | le fourbe | tirailleur |
| Gobelins | Morva | la vaillante | fantassine |

### Upgrades disponibles (votables)
| Upgrade | Effet | Défaut loufoque |
| --- | --- | --- |
| Lunettes laser | tir rapide qui ricoche | peut partir au hasard, et le ricochet touche aussi les alliés |
| Épée magique | coup de zone qui projette | — |
| Grenades | explosion de zone en cloche | touche aussi les alliés, et parfois explose sur soi |
| Bombe à glu | ralentit une zone | — |
| Lance-poulet | projette les ennemis | part parfois sur un allié |
| Casserole en fonte | plus de PV, plus lourd | un peu plus lent |

### Incidents d'arène
Chute de roche sur la mêlée, boule de feu lancée des gradins, éclair en chaîne sur un héros,
flaque de boue. Une ombre au sol les annonce, et ils deviennent plus fréquents quand l'arène rétrécit.

### Mise en scène
- Intro « GNOMES contre GOBELINS », puis présentation des héros et de leurs upgrades, puis « COMBAT ! ».
- Barre de vie et nom au-dessus des héros uniquement.
- Caméra qui zoome sur les moments forts : héros K.O., duel de héros, raté d'upgrade, héros seul contre tous.
- Public qui réagit aux exploits et peut prendre une flèche perdue (« AÏE ! »).
- Écran de fin : vainqueur, bilan des héros, puis carte de vote :
  « Kevin recevra la prochaine upgrade — votez : 1 laser, 2 épée, 3 grenades ».

### Production d'un épisode
1. `scout` simule 100 seeds avec l'état actuel des héros et classe les plus spectaculaires
   (retournement, héros seul contre tous, durée dans la fenêtre).
2. `plan` fige l'épisode : seed, vainqueur, héros perdant qui recevra l'upgrade, 3 options.
3. Le navigateur enregistre la vidéo en 1080 × 1920, environ 87 s au total.
4. Après publication, `vote` compte les voix (saisie manuelle ou export de commentaires, une voix par auteur).
5. `status` montre l'état des héros et alerte quand un camp gagne plus de 80 % des combats.

### Visuels
Les personnages sont des sprite sheets animées **de remplacement** (formes générées par code) :
repos, marche, attaque, chute. La chaîne d'intégration des vrais sprites est prête :
on dépose le PNG, `npm run sprites -- check` vérifie, `import` branche.

---

## 3. Chiffres actuels (200 combats simulés)

| Mesure | Valeur |
| --- | --- |
| Durée moyenne d'un combat | 72 s (min 62, max 80) |
| Combats entre 65 et 80 s | 90 % |
| Victoires | gnomes 53 % · gobelins 47 % |
| Retournements (le perdant a été 20 % plus fort à un moment) | 12 % |
| Fins en « héros seul contre 3 ennemis ou plus » | environ 50 % |
| Part des K.O. faits par les héros (6 % des unités) | 20 % |
| Poids d'une upgrade sur le taux de victoire | +3 à +13 points |

---

## 4. Décisions en attente

### 4.1 Place des héros
Les héros font les retournements, mais finissent très souvent seuls contre tous.

| PV des héros | Héros seul contre 3+ | Retournements |
| --- | --- | --- |
| actuels | 54 % | 11 % |
| −20 % | 32 % | 6 % |
| −30 % | 34 % | 0 % |

Faut-il des héros plus fragiles, garder ces fins comme signature, ou chercher un autre levier
(par exemple des troupes d'élite, ou des héros qui s'épuisent) ?

### 4.2 Questions ouvertes du brief initial
- **Édition des briques** : fichiers JSON seulement, ou une petite interface visuelle ?
- **Héros perdant qui reçoit l'upgrade** : choisi par l'auteur (aujourd'hui le script propose le moins équipé), par vote, ou en rotation ?
- **Comptage des votes multi-plateformes** : outil existant, ou script maison via les API (il faudra des accès aux comptes) ?
- **Effectifs** : 50 par camp aujourd'hui. Les héros restent-ils assez lisibles sur un téléphone ?
- **Fin d'arc** : après un nombre fixe d'épisodes, ou quand un camp devient trop fort ?

### 4.3 Pistes non tranchées
- **Son** : musique, bruitages, cris du public ? Rien pour l'instant.
- **Nouvelles upgrades et nouveaux incidents** : chacun s'ajoute en JSON, sans code, tant qu'il combine les effets existants (dégâts ponctuels ou de zone, projectile, ricochet, recul, ralentissement).
- **Nouveaux héros** en cours d'arc, ou seulement entre deux arcs ?
- **Identité visuelle** : style des sprites, cartons et logo « faits main ».
- **Rythme de publication** et plateformes visées en premier.
- **Fil rouge du feuilleton** : rivalités entre héros, lieux d'arène différents selon l'arc, épisodes spéciaux.

---

## 5. Ce qui ne dépend que de toi
- Générer les sprites (PixelLab ou Retro Diffusion), puis les retoucher dans Aseprite. Le guide est dans `docs/sprites.md`.
- Planifier et enregistrer le premier épisode de l'arc 1.
- Créer les comptes dédiés sur les plateformes.

---

## 6. Prochaines directives

> À remplir à la fin du brainstorm. Une ligne suffit par point ; « — » si rien à dire.

**Priorité du prochain lot** (une ou deux choses au plus) :
- 

**Décision sur la place des héros** (§ 4.1) :
- 

**Réponses aux questions ouvertes** (§ 4.2) :
- Édition des briques :
- Héros perdant qui reçoit l'upgrade :
- Comptage des votes :
- Effectifs :
- Fin d'arc :

**Contenu à ajouter** (upgrades, incidents, héros ; nom, idée, défaut loufoque) :
- 

**Son et identité visuelle** :
- 

**Ce qu'il ne faut surtout pas changer** :
- 

**Critères de réussite du prochain lot** :
- 
