// Zone sûre des overlays des réseaux sociaux (union TikTok / Reels / Shorts) sur le canvas 1080 × 1920.
// Tout texte important doit tenir dans SAFE.text ; l'action peut descendre jusqu'à SAFE.action.bottom.
// Le côté gauche est le seul sans overlay : c'est là que va l'interface permanente.
// `?safe=1` dessine ces zones par-dessus la vidéo pour vérifier un cadrage.

export const SAFE = {
  /** Barre « Suivis / Pour toi », recherche, dégradé du haut. */
  top: 220,
  /** Pseudo, légende courte, musique, barre de navigation (y > 1500). */
  bottom: 420,
  /** Légende longue (2-3 lignes) : rien d'important sous cette ligne. */
  captionTop: 1240,
  /** Rail j'aime / commentaires / partage, à droite, entre railY[0] et railY[1]. */
  right: 140,
  railY: [700, 1500] as const,
  left: 40,
  /** Rectangle garanti pour le texte important. */
  text: { x: 40, y: 220, w: 900, h: 1020 },
  /** Bande centrée sur l'écran (x 540) qui évite aussi le rail de droite : titres et cartes centrés. */
  centered: { x: 140, w: 800 },
  /** Rectangle où l'action reste visible. */
  action: { x: 40, y: 220, w: 900, bottom: 1500 },
  /** Centre visuel de la zone utile (et non le milieu du canvas). */
  centerY: 860,
} as const;

/** Les zones couvertes par l'overlay, en rectangles écran (pour le debug et les tests). */
export function overlayRects(width = 1080, height = 1920): { x: number; y: number; w: number; h: number; name: string }[] {
  return [
    { name: 'haut', x: 0, y: 0, w: width, h: SAFE.top },
    { name: 'légende', x: 0, y: SAFE.captionTop, w: width, h: height - SAFE.captionTop },
    { name: 'rail', x: width - SAFE.right, y: SAFE.railY[0], w: SAFE.right, h: SAFE.railY[1] - SAFE.railY[0] },
  ];
}

/** Vrai si un rectangle écran (bornes d'un texte, d'une carte) mord sur une zone d'overlay. */
export function hitsOverlay(r: { x: number; y: number; width: number; height: number }, width = 1080, height = 1920): string | null {
  for (const o of overlayRects(width, height)) {
    if (r.x < o.x + o.w && r.x + r.width > o.x && r.y < o.y + o.h && r.y + r.height > o.y) return o.name;
  }
  return null;
}
