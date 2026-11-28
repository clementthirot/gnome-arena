// Tête de lecture du visualiseur : barre HTML posée sous le canvas (jamais dans la vidéo enregistrée).
// Lecture / pause, vitesse ×1 à ×4 et saut à n'importe quel moment du combat. La simulation étant
// déterministe, aller à t revient à rejouer le combat jusqu'à t en accéléré, sans son (ArenaScene.seek).

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

let target: ScrubTarget | undefined;
let ui: { root: HTMLDivElement; range: HTMLInputElement; label: HTMLSpanElement; play: HTMLButtonElement; speeds: HTMLButtonElement[] } | undefined;
let dragging = false;

const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function button(text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText =
    'min-width:44px;height:36px;padding:0 8px;font:11px "Press Start 2P",monospace;color:#fff;background:#2a2438;border:2px solid #000;border-radius:6px;cursor:pointer;touch-action:manipulation';
  return b;
}

function build(): NonNullable<typeof ui> {
  const root = document.createElement('div');
  root.id = 'scrubber';
  root.style.cssText =
    'position:fixed;left:50%;bottom:max(8px,env(safe-area-inset-bottom));transform:translateX(-50%);width:min(96vw,640px);box-sizing:border-box;' +
    'display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 10px;background:rgba(14,12,20,.82);border:2px solid #000;border-radius:10px;' +
    'color:#e8e0f8;font:11px "Press Start 2P",monospace;z-index:15;opacity:.45;transition:opacity .2s';
  const show = () => (root.style.opacity = '1');
  const hide = () => {
    if (!dragging) root.style.opacity = '.45';
  };
  root.addEventListener('pointerenter', show);
  root.addEventListener('pointerleave', hide);
  root.addEventListener('touchstart', show, { passive: true });

  const play = button('❚❚');
  play.title = 'Lecture / pause (espace)';
  play.onclick = () => target?.togglePause();

  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.step = '0.1';
  range.style.cssText = 'flex:1 1 180px;min-width:120px;height:28px;accent-color:#ffe14a;cursor:pointer';
  range.title = 'Aller à un moment du combat (← → : 5 s)';
  const label = document.createElement('span');
  label.style.cssText = 'min-width:96px;text-align:center;white-space:nowrap';
  range.addEventListener('pointerdown', () => (dragging = true));
  range.addEventListener('input', () => {
    dragging = true;
    label.textContent = `${clock(Number(range.value))} / ${clock(target?.duration ?? 0)}`;
  });
  // On ne rejoue qu'au lâcher : glisser le curseur ne coûte rien.
  range.addEventListener('change', () => {
    dragging = false;
    target?.seek(Number(range.value));
  });

  const speeds = SPEEDS.map((s) => {
    const b = button(`×${s}`);
    b.title = `Vitesse ×${s}`;
    b.onclick = () => target?.setSpeed(s);
    return b;
  });
  const group = document.createElement('div');
  group.style.cssText = 'display:flex;gap:6px;margin-left:auto';
  group.append(...speeds);
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
  return { root, range, label, play, speeds };
}

/** Branche la barre sur la scène de combat qui vient de démarrer (créée à la première fois). */
export function attachScrubber(t: ScrubTarget): void {
  target = t;
  ui ??= build();
}
