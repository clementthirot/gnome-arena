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
| Lunettes laser | grand rayon qui se charge 0,8 s, traverse l'arène et rebondit une fois sur un mur | touche tout ce qui est sur sa ligne, alliés compris, et peut partir au hasard |
| Épée magique | tourbillon autour du héros qui projette tout le monde | — |
| Grenades | explosion de zone en cloche | touche aussi les alliés, et parfois explose sur soi |
| Bombe à glu | ralentit une zone | — |
| Lance-poulet | projette les ennemis | part parfois sur un allié |
| Casserole en fonte | plus de PV, plus lourd | un peu plus lent |

### Incidents d'arène
Météore qui tombe du ciel et projette les unités dans les airs, chute de roche sur la mêlée,
boule de feu lancée des gradins, éclair en chaîne sur un héros, flaque de boue, supporters qui
envahissent l'arène pour se battre. La zone qui se resserre est un gaz toxique craché par des conduits. Une ombre au sol les annonce, et ils deviennent plus fréquents quand l'arène rétrécit.

### Mise en scène
- Intro « GNOMES contre GOBELINS », puis présentation des héros et de leurs upgrades, puis « COMBAT ! ».
- Barre de vie et nom au-dessus des héros uniquement.
- Caméra qui zoome sur les moments forts : héros K.O., duel de héros, raté d'upgrade, héros seul contre tous.
- Public qui réagit aux exploits et peut prendre une flèche perdue (« AÏE ! »).
- K.O. aériens : les vaincus s'envolent parfois en vrille et retombent avec une onomatopée (« BOUM ! », « PAF ! »).
- Les gros reculs font rebondir les personnages ; les morts laissent une petite flaque de sang.
- Le public prend les coups manqués : flèches perdues, explosions et rayons qui débordent.
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
| Durée moyenne d'un combat | 70 s (min 60, max 80) |
| Combats entre 35 et 45 s (combat seul ; ~60 s avec intro et fin) | voir npm run bench |
| Victoires | gnomes 52 % · gobelins 48 % |
| Retournements (le perdant a été 20 % plus fort à un moment) | 10 % |
| Fins en « héros seul contre 3 ennemis ou plus » | environ 50 % |
| Part des K.O. faits par les héros (6 % des unités) | 20 % |
| Poids d'une upgrade sur le taux de victoire | +3 à +16 points |

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

Décisions tranchées
• Place des héros : PV inchangés. Le scout pénalise une seed dont le type de fin est le même qu'à l'épisode précédent.
• Édition des briques : interface de régie pour les fréquences des incidents et des gags ; unités, sprites, upgrades et effets restent en JSON et dans le code.
• Héros qui reçoit l'upgrade : choisi par Clément dans la régie (le script propose le moins équipé).
• Comptage des votes : saisie manuelle ou export de commentaires ; API des plateformes plus tard.
• Effectifs : réglables dans la régie.
• Fin d'arc : décidée par Clément, selon l'intérêt des combats et l'audience ; l'alerte des 80 % reste indicative.
• Biome de l'arène : choisi dans la régie.
Juice cartoon (rendu uniquement)
• Vol en cloche avec hauteur simulée, rotation, ombre au sol qui rétrécit en montant.
• Squash and stretch au décollage et à l'atterrissage, nuage de poussière, rebonds décroissants.
• Hit stop d'environ 0,1 s et tremblement d'écran sur les gros impacts (météore, charge de héros).
• Flash blanc à l'impact, étoiles au-dessus des étourdis, anticipation avant charge et chute de météore.
• Bulles d'émotion (« ! », goutte de sueur) sur les peureux qui fuient.
Débris et objets perdus
• Débris d'impact éphémères (dents, mottes de terre) projetés en cloche.
• Objets perdus qui restent au sol (bonnets, casques, flèches plantées).
• Hasard tiré de la seed, nombre de débris plafonné.
Sang
• Remplacé par des marques cartoon (étoiles, suie, boue), ou flaque qui sèche et vire au brun, fondue dans le sol avec un tramage pixel.
Public
• Le public lance des objets (petite bombe, tomate, chaussure) comme incident aléatoire, avec ombre d'annonce.
• Les supporters qui sautent dans l'arène quittent visiblement leur place : la tribune se vide à cet endroit, saut en cloche par-dessus le muret.
• Rayons, flèches et explosions continuent de toucher le public.
• Trébuchement : un projectile du public (tomate, caillou) étourdit brièvement l'unité touchée, qui titube avec des étoiles ou tombe face contre terre puis se relève. Réutilise l'état « étourdi » existant.
• Idée pour plus tard : l'empereur qui descend dans l'arène lors d'épisodes spéciaux.
Slapstick (rare et réglable en JSON : probabilité + plafond par combat)
• Choc de têtes : deux chargeurs qui se percutent restent tous deux assommés.
• Effet bowling : règle permanente du moteur, pas un gag rare. Toute unité projetée qui retombe sur d'autres les repousse et les étourdit brièvement, avec peu ou pas de dégâts pour ne pas fausser l'équilibrage (à vérifier au bench).
• Victoire prématurée : danse après un K.O., interrompue par un coup. Très rare (1 à 2 fois par combat au plus), seulement pour une unité un peu à l'écart après un duel, pour rester lisible.
• Arme perdue : l'arme s'envole, l'unité court la ramasser. Rare et courte, pour ne pas rallonger les combats.
• Plus tard : trébucher sur les objets perdus au sol.
Intro et fin d'épisode
• Intro : fanfare, titre qui tombe avec rebond, « Épisode N », héros, « 3, 2, 1, COMBAT ! ».
• Fin sans arrêt brutal : ralenti sur le dernier K.O., annonce du vainqueur pendant que l'arène continue de vivre, animations terminées proprement.
• Célébration : bannières aux couleurs du vainqueur, confettis, public qui saute.
• Carte d'upgrade : portrait du héros bénéficiaire, 3 upgrades qui défilent façon machine à sous, numéros 1-2-3 très lisibles.
Barre de rapport de force
• Une seule barre en haut de l'écran, partagée entre les couleurs des deux camps, qui se déplace selon les PV restants de chaque camp (la même mesure que la victoire à 80 s).
• Mouvement fluide, tremblement et éclat à la jonction lors d'un gros coup, flash quand un héros tombe.
Unités spéciales symétriques (paramétrables)
• Nouveau rôle « lanceur de sorts » : mêmes fonctions et mêmes stats dans les deux camps, seuls le skin, les animations et le nom changent (mage gnome, sorcier gobelin).
• Sorts composés des effets existants (onde de choc qui disperse la mêlée, ralentissement, projection…), définis en JSON.
• Effectif par camp réglable dans battle.json, 0 par défaut, pour tester sans toucher à l'équilibrage actuel.
• Option de test : arrivées par vagues et unités qui contournent par les flancs, pour casser le paquet central.
Engagement et feuilleton
• Running gag : un spectateur reconnaissable (chapeau ridicule), présent à chaque épisode, qui finit toujours touché.
• Répliques des héros en bulles, selon leur personnalité (Kevin : « Pas moi ! » ; Bob : cri de guerre).
• Rivalités : carton « DUEL » quand deux héros rivaux se croisent (ex. Bob contre Grok).
• Annonces de commentateur sur les séries : « TRIPLE K.O. ! », « BOB EST EN FEU ! ».
• Prono en début de vidéo : « Qui va gagner ? Dis-le en commentaire ! ».
• Stats cumulées sur la carte de fin (K.O. de chaque héros depuis le début de l'arc, meilleur raté de l'épisode).
• Arènes différentes par arc (forêt, neige où l'on glisse, volcan).
L'empereur de l'arène
• Un personnage sur un trône dans une loge des tribunes, façon César, visible du début à la fin, qui ne combat jamais.
• Il lance le combat (geste, « Que le massacre commence ! »), porte les annonces de commentateur en bulles, et réagit aux moments forts.
• À la fin : pouce levé vers le vainqueur, célébration, puis il présente la roulette des upgrades.
Mode régie
• Panneau avant le combat : épisode suivant proposé, upgrades des héros chargées depuis l'arc, corrections à la main.
• Choix de la seed parmi les résultats du scout, du héros bénéficiaire et des 3 options de vote.
• Boutons « aperçu » et « enregistrer » ; sauvegarde dans les fichiers d'arc via un petit relais du serveur Vite.
Réglages supplémentaires de la régie : fréquences des incidents et des gags, effectif par camp, biome de l'arène, bouton de fin d'arc.
Son
• Jingle d'intro, bruitages de coups et d'explosions, cris du public, petite boucle musicale.
Ce qu'il ne faut pas changer : le déterminisme, l'équilibrage actuel, les données en JSON.
Critères de réussite
[ ] Un épisode complet, de l'intro au vote, s'enregistre sans image figée ni animation en boucle.
[ ] Même seed = même vidéo, débris compris.
[ ] Les héros restent repérables malgré les débris.
[ ] Préparer un épisode depuis la régie prend moins de 2 minutes.
Questions ouvertes
[ ] Édition des briques : fichiers JSON seuls, ou petite interface visuelle ?
[ ] Comment choisir le héros perdant qui reçoit l'upgrade : vote aussi, ou rotation ?
[ ] Outil de comptage des votes multi-plateformes : outil existant ou script maison ?
[ ] Combien de troupes par camp pour que les héros restent lisibles ?
[ ] Critères de fin d'arc : nombre d'épisodes, ou niveau de puissance atteint ?

---

## 7. Suivi des directives (3 novembre 2026)

Fait :
- Régie (`/regie.html`) : scout dans le navigateur avec pénalité du type de fin, choix du héros et des 3 options,
  aperçu, épisode figé, saisie ou import du vote, réglages de l'arc (biome, effectifs, fréquences des incidents
  et des gags), clôture et création d'arc. Chaque épisode garde une copie de ses réglages.
- Juice cartoon : arrêt sur image, étirement au décollage, ramassé avant la charge, étoiles des étourdis,
  sueur des fuyards ; débris et objets perdus plafonnés ; flaques qui sèchent et virent au brun, tramées.
- Public : tomates, chaussures, bombes (étourdissement) ; supporters qui quittent leur place ; coups perdus.
- Slapstick : bowling (permanent, sans dégâts), choc de têtes, danse de victoire interrompue, arme perdue.
- Intro (fanfare, titre qui rebondit, héros, prono, 3-2-1) et fin (ralenti, épilogue, célébration,
  machine à sous, stats cumulées de l'arc, raté de l'épisode).
- Barre de rapport de force, empereur, commentateur, répliques, DUEL entre rivaux, spectateur récurrent.
- Lanceur de sorts symétrique (0 par défaut), vagues et flancs (option), biomes sable / forêt / neige / volcan.
- Son synthétisé, embarqué dans la vidéo (webm).
- Même seed = même vidéo : le hasard du rendu est tiré de la seed et réamorcé à chaque tick.

Pas encore fait :
- Trébucher sur les objets perdus au sol ; l'empereur qui descend dans l'arène (épisodes spéciaux).
- Comptage des votes via les API des plateformes.
- Vagues + flancs activés ensemble déséquilibrent (65/35) : à revoir avant de s'en servir.

À vérifier de ton côté :
- Un enregistrement complet de bout en bout (le téléchargement final n'a pas été lancé pendant le développement).
- La vidéo sort en webm (le mp4 avec son ne fonctionne pas dans Chrome) : à convertir si une plateforme le refuse.

---

## 8. Reprise du 23 novembre 2026 (session autonome)

Équipe d'agents : game design, UI/animation, réalisation, testeur, puis un arbitre qui a tranché les contradictions,
4 lots d'implémentation en parallèle, une ronde de test sur la version intégrée et une ronde de corrections.

Fait :
- **Boucle d'upgrade** : options tirées au sort (déterministe) et filtrées par rôle, une seule règle pour la CLI et la régie,
  héros saturés exclus, vote 0/0/0 refusé, vote annulable (`unvote`), gel de la régie resimulé, un seul arc ouvert à la fois,
  écritures concurrentes CLI/régie détectées, upgrades en double ou inconnues refusées.
- **Révélation du vote précédent** en ouverture (machine à sous qui s'arrête sur la gagnante, % des voix, accessoire qui vole
  jusqu'au héros, « NOUVEAU ») ; combat lancé vers 4 s au lieu de 8,5 s.
- **Fin en deux temps** (vainqueur + MVP, puis carte de vote seule dans la zone sûre), « MATCH NUL » au lieu de « VICTOIRE ÉGALITÉ »,
  fondu final qui reboucle sur la première image.
- **Zone sûre des overlays** (`src/render/safeZone.ts`, `?safe=1`) ; barre de rapport de force verticale à gauche ; caméra
  centrée sur la zone utile ; textes vidéo ≥ 26 px.
- **Réalisation** : ralentis avec bandes cinéma sur la chute d'un héros et le dernier K.O., plan du vainqueur, easter eggs rares
  (public qui explose, ola, empereur qui tombe, spectateur récurrent accessoirisé), mini-boss visible (le héros grossit et
  porte une couronne à partir de 3 upgrades, rendu seulement).
- **Rendu déterministe** : particules, confettis, répliques et timings calés sur le temps de simulation.
- **Nouvelles upgrades** : tarte à la crème, parapluie à foudre, sifflet à supporters ; « BONG ! » de la casserole ;
  incident « poule géante » (désactivé par défaut pour ne pas changer les seeds existantes).
- Combat sans upgrade strictement identique au bench (100 seeds) : l'équilibrage n'a pas bougé.

Questions ouvertes pour Clément :
- Héros suggéré : le moins équipé (ta règle, gardée) ou le plus équipé non saturé, pour qu'un vrai mini-boss émerge ?
- Activer la poule géante (change toutes les seeds) ?
- Que faire quand un héros a toutes les upgrades : fin d'arc, upgrades « niveau 2 », nouvelles upgrades ?
- Publication automatique (n8n, API des plateformes) et comptage des votes par API : à décider ensemble.
