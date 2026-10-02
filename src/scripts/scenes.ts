/*
  THE SCENE TABLE — single source of truth for the film's rhythm.

  Every frame of the flipbook lives in a scene; each scene owns a slice
  of the track measured in vh. The track height, the progress bands
  (theme, HUD ink, live frame) and every timeline beat derive from this
  table — nothing else may hardcode a %.

  LEGACY_MAP preserves the original 1100vh world (before the LED scene
  existed) as scene-local fractions, so old storyboard numbers keep
  their exact px/vh durations — scenes merely shift along the track.
  Adding a page = one entry here (+vh), nothing else.
*/
export const SCENES = [
  { id: 'hero', vh: 132 },   // was 12% of 1100vh
  { id: 'led', vh: 300 },    // NEW scene — extended for the windows plateau (§5)
  { id: 'lime', vh: 198 },   // was 18%
  { id: 'snap', vh: 467.5 }, // was 42.5%
  { id: 'work', vh: 231 },   // was 21%
  { id: 'foot', vh: 71.5 },  // was 6.5%
] as const;

export type SceneId = (typeof SCENES)[number]['id'];

export const TOTAL_VH = SCENES.reduce((a, s) => a + s.vh, 0);

/* scene band as a fraction of the whole film (0..1) */
export function sceneStart(id: SceneId): number {
  let acc = 0;
  for (const s of SCENES) {
    if (s.id === id) return acc / TOTAL_VH;
    acc += s.vh;
  }
  return 0;
}
export function sceneLen(id: SceneId): number {
  return (SCENES.find((s) => s.id === id)?.vh ?? 0) / TOTAL_VH;
}
/* global film position for a local fraction of a scene (may exceed
   [0,1] for cross-scene pre-rolls — explicit by design) */
export function pos(id: SceneId, local: number): number {
  return sceneStart(id) + local * sceneLen(id);
}

/* legacy global band per scene, in the OLD 1100vh world — used to
   translate historical storyboard positions into scene-local ones */
export const LEGACY_MAP: Record<Exclude<SceneId, 'led'>, [number, number]> = {
  hero: [0.0, 0.12],
  lime: [0.12, 0.3],
  snap: [0.3, 0.725],
  work: [0.725, 0.935],
  foot: [0.935, 1.0],
};

/* mapper factory: oldP(0..1 of the 1100vh film) -> new global position */
export function legacy(id: Exclude<SceneId, 'led'>): (oldP: number) => number {
  const [a, b] = LEGACY_MAP[id];
  const len = sceneLen(id);
  return (oldP: number) => sceneStart(id) + ((oldP - a) / (b - a)) * len;
}
