// Tête de lecture du visualiseur : barre HTML posée sur le canvas (jamais dans la vidéo enregistrée).
// Comme un lecteur vidéo : invisible tant qu'on ne touche pas l'arène, elle apparaît au toucher (ou quand
// la souris bouge) et disparaît après quelques secondes sans interaction ; elle reste affichée en pause.
// Lecture / pause, vitesse ×1 à ×4, saut à n'importe quel moment du combat, rejouer, et dans la régie au
// téléphone, le bouton qui bascule vers la régie. La simulation étant déterministe, aller à t revient à
// rejouer le combat jusqu'à t en accéléré, sans son (ArenaScene.seek).

/** Ce que la scène de combat expose à la barre. */
export interface ScrubTarget {
  /** Temps de combat affiché (s). */
  time(): number;
  /** Durée totale du combat (s), épilogue compris. */
  duration: number;
  speed(): number;
  paused(): boolean;
  /** Rattrapage en cours (la barre affiche « … »). */
  seeking(): boolean;
  seek(t: number): void;
  setSpeed(s: number): void;
  togglePause(): void;
}

const SPEEDS = [1, 2, 3, 4];
/** Sans interaction pendant ce délai (ms), la barre s'efface. */
const HIDE_AFTER_MS = 3000;

let target: ScrubTarget | undefined;
let built = false;

const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Dans la régie, l'arène est une iframe : rejouer et basculer vers la régie se font chez la page parente. */
const embedded = (() => {
  try {
    return window.parent !== window;
  } catch {
    return true;
  }
})();
const toRegie = (action: 'replay' | 'regie') => window.parent.postMessage({ type: 'arena-bar', action }, '*');

function button(text: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.style.cssText =
    'flex:1 1 auto;min-width:36px;height:40px;padding:0 4px;white-space:nowrap;font:11px "Press Start 2P",monospace;color:#fff;background:#2a2438;border:2px solid #000;border-radius:8px;cursor:pointer;touch-action:manipulation';
  return b;
}

function build(): void {
  built = true;
  const root = document.createElement('div');
  root.id = 'scrubber';
  root.style.cssText =
    'position:fixed;left:50%;bottom:max(10px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(96vw,640px);box-sizing:border-box;' +
    'display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 10px;background:rgba(14,12,20,.88);border:2px solid #000;border-radius:12px;' +
    'color:#e8e0f8;font:11px "Press Start 2P",monospace;z-index:15;transition:opacity .25s;touch-action:manipulation';

  // ---- affichage façon lecteur vidéo
  let visible = false;
  let dragging = false;
  let hideTimer = 0;
  const setVisible = (on: boolean) => {
    visible = on;
    root.style.opacity = on ? '1' : '0';
    root.style.pointerEvents = on ? 'auto' : 'none';
  };
  const armHide = () => {
    clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      if (!dragging && !target?.paused()) setVisible(false);
      else armHide();
    }, HIDE_AFTER_MS);
  };
  const wake = () => {
    setVisible(true);
    armHide();
  };
  setVisible(false);
  // Toucher l'arène affiche la barre ; la toucher encore (barre visible) la cache, comme sur YouTube.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (root.contains(e.target as Node)) return wake();
      if (visible && e.pointerType !== 'mouse') {
        clearTimeout(hideTimer);
        setVisible(false);
      } else wake();
    },
    true,
  );
  // À la souris, il suffit de bouger au-dessus de l'arène.
  window.addEventListener('pointermove', (e) => e.pointerType === 'mouse' && wake(), { passive: true });
  root.addEventListener('pointerdown', wake);
  root.addEventListener('input', wake);

  // ---- ligne 1 : lecture et tête de lecture
  const play = button('❚❚', 'Lecture / pause (espace)');
  play.onclick = () => target?.togglePause();

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.1';
  range.style.cssText = 'flex:1 1 160px;min-width:110px;height:36px;margin:0;accent-color:#ffe14a;cursor:pointer;touch-action:none';
  range.title = 'Aller à un moment du combat (← → : 5 s)';
  const label = document.createElement('span');
  label.style.cssText = 'min-width:92px;text-align:center;white-space:nowrap';
  range.addEventListener('pointerdown', () => (dragging = true));
  range.addEventListener('input', () => {
    dragging = true;
    label.textContent = `${clock(Number(range.value))} / ${clock(target?.duration ?? 0)}`;
  });
  // On ne rejoue qu'au lâcher : glisser le curseur ne coûte rien.
  range.addEventListener('change', () => {
    dragging = false;
    target?.seek(Number(range.value));
    armHide();
  });
  const stopDrag = () => {
    if (dragging) armHide();
    dragging = false;
  };
  range.addEventListener('pointerup', stopDrag);
  range.addEventListener('pointercancel', stopDrag);

  // ---- ligne 2 : vitesses, rejouer, régie
  const speeds = SPEEDS.map((s) => {
    const b = button(`×${s}`, `Vitesse ×${s}`);
    b.onclick = () => target?.setSpeed(s);
    return b;
  });
  const replay = button('↻', 'Rejouer');
  // Dans la régie : même effet que son bouton Rejouer (recharge l'aperçu). Seule : retour au début du combat.
  replay.onclick = () => (embedded ? toRegie('replay') : target?.seek(0));
  const regie = button('⚙ Régie', 'Ouvrir la régie');
  regie.style.background = '#ffb347';
  regie.style.color = '#000';
  regie.style.display = 'none';
  regie.onclick = () => toRegie('regie');
  // La régie dit si elle est en mise en page téléphone (une vue à la fois) : alors seulement, le bouton sert.
  window.addEventListener('message', (e) => {
    if (e.source === window.parent && e.data?.type === 'regie-layout') regie.style.display = e.data.phone ? '' : 'none';
  });
  if (embedded) window.parent.postMessage({ type: 'arena-bar', action: 'hello' }, '*');

  const group = document.createElement('div');
  group.style.cssText = 'display:flex;gap:6px;width:100%';
  const speedBox = document.createElement('div');
  speedBox.style.cssText = 'display:flex;gap:6px;flex:4 1 0;min-width:0';
  speedBox.append(...speeds);
  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;gap:6px;flex:3 1 0;min-width:0';
  actions.append(replay, regie);
  group.append(speedBox, actions);
  root.append(play, range, label, group);
  document.body.append(root);

  const refresh = () => {
    requestAnimationFrame(refresh);
    if (!target) return;
    range.max = String(Math.max(1, target.duration));
    if (!dragging) {
      range.value = String(Math.min(target.duration, target.time()));
      label.textContent = target.seeking() ? '…' : `${clock(target.time())} / ${clock(target.duration)}`;
    }
    play.textContent = target.paused() ? '▶' : '❚❚';
    const speed = target.speed();
    speeds.forEach((b, i) => (b.style.background = SPEEDS[i] === speed ? '#c8442a' : '#2a2438'));
  };
  requestAnimationFrame(refresh);
}

/** Branche la barre sur la scène de combat qui vient de démarrer (créée à la première fois). */
export function attachScrubber(t: ScrubTarget): void {
  target = t;
  if (!built) build();
}
