/* A quiet ridge-line banner: the homepage's wireframe landscape, drifting along behind a page's heading.
   heroRidges(canvas): the canvas needs a CSS size. It takes no input, so scrolling and the keyboard are left alone. */
import { createFlight } from '/assets/flight.js';

export function heroRidges(canvas, { amp = 0.5, seed = 1 } = {}) {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return createFlight(canvas, {
    rows: 52, points: 120, amp, rowWidth: 5, horizon: 0.3, interactive: false, rate: () => (reduce ? 1.5 : 6),
    sample(row, n) {                                                  // a valley down the middle, hills either side
      for (let i = 0; i < row.length; i++) {
        const x = i / (row.length - 1), side = Math.pow(Math.abs(x - 0.5) * 2, 1.3);
        const hill = 0.55 + Math.sin(n * 0.11 + x * 6 + seed) * 0.3 + Math.sin(n * 0.047 + x * 13 + seed * 2) * 0.2;
        row[i] = Math.max(0, hill * (0.08 + side * 1.1));
      }
    }
  });
}
