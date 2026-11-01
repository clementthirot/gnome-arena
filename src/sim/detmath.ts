// Mathématiques déterministes. La norme JavaScript laisse la précision de Math.hypot, sin, cos
// et pow à chaque moteur : Node, Chrome, Firefox et Safari peuvent différer au dernier bit, et
// le chaos de la mêlée amplifie l'écart jusqu'à changer le vainqueur. On n'utilise ici que
// + - * / et Math.sqrt, exactement arrondis partout (IEEE 754).

export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

const TWO_PI = 6.283185307179586;
const PI = 3.141592653589793;
const HALF_PI = 1.5707963267948966;

/** Sinus par réduction d'argument puis série de Taylor (erreur < 1e-9 sur [-π/2, π/2]). */
export function sin(x: number): number {
  let r = x - TWO_PI * Math.round(x / TWO_PI);
  if (r > HALF_PI) r = PI - r;
  else if (r < -HALF_PI) r = -PI - r;
  const r2 = r * r;
  return r * (1 - (r2 / 6) * (1 - (r2 / 20) * (1 - (r2 / 42) * (1 - (r2 / 72) * (1 - (r2 / 110) * (1 - r2 / 156))))));
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

/** Racine n-ième d'un réel positif par la méthode de Newton (nombre d'itérations fixe). */
export function nthRoot(a: number, n: number): number {
  if (a <= 0) return 0;
  let x = 1;
  for (let i = 0; i < 100; i++) {
    let p = 1;
    for (let k = 0; k < n - 1; k++) p *= x;
    x = ((n - 1) * x + a / p) / n;
  }
  return x;
}
