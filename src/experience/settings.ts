/**
 * Quality setting — the single user-tunable that scales the experience.
 * Persisted in localStorage, broadcast via a CustomEvent so the WebGL layer
 * (and anything else) can rebuild at the new budget without a reload.
 */
export type Quality = 'high' | 'medium' | 'low';

const KEY = 'portfolio:quality';

export function getQuality(): Quality {
  const stored = localStorage.getItem(KEY);
  return stored === 'high' || stored === 'medium' || stored === 'low'
    ? stored
    : defaultQuality();
}

export function setQuality(q: Quality) {
  localStorage.setItem(KEY, q);
  window.dispatchEvent(new CustomEvent<Quality>('qualitychange', { detail: q }));
}

function defaultQuality(): Quality {
  // Coarse pointer / small screen → medium. Anything that screams → low stays manual.
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = window.innerWidth < 768;
  return coarse || small ? 'medium' : 'high';
}
