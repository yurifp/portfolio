/*
  Stack cards for the lime scene (7×4 density grid).
  icon = simple-icons key (imported in LimeScene).
  Items 7–10 are SUGGESTIONS pending user confirmation.
*/
export interface Stack {
  id: string;
  label: string;
  icon: string; // simple-icons export name
  todo?: boolean;
}

export const stacks: Stack[] = [
  { id: 'nodedotjs', label: 'Node.js', icon: 'siNodedotjs' },
  { id: 'typescript', label: 'TypeScript', icon: 'siTypescript' },
  { id: 'react', label: 'React', icon: 'siReact' },
  { id: 'threedotjs', label: 'Three.js', icon: 'siThreedotjs' },
  { id: 'astro', label: 'Astro', icon: 'siAstro' },
  { id: 'gsap', label: 'GSAP', icon: 'siGreensock' },
  // TODO confirmar: itens 7–10 são sugestão
  { id: 'nextdotjs', label: 'Next.js', icon: 'siNextdotjs', todo: true },
  { id: 'tailwindcss', label: 'Tailwind CSS', icon: 'siTailwindcss', todo: true },
  { id: 'postgresql', label: 'PostgreSQL', icon: 'siPostgresql', todo: true },
  { id: 'docker', label: 'Docker', icon: 'siDocker', todo: true },
];
