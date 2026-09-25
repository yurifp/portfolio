/*
  Central content source — swap everything here, the design stays.
  Bio/tags/stats/roles are placeholders or real Yuri data; replace freely.
*/

export const site = {
  wordmark: 'YURI.FERREIRA',
  name: 'Yuri Ferreira Paulo',
  role: 'software engineer',
  born: "95'",
  location: {
    city: 'Salvador, BR',
    timezone: 'America/Bahia',
    coords: `12°58'15.9"S 38°30'39.6"W`,
  },
  email: 'dev.yurifpaulo@gmail.com',
  cv: '/cv/yuri-ferreira-en.pdf',
  copyright: '@2026 by Yuri Ferreira Paulo',
};

/* Hero bio — placeholder voice, same structural roles as the reference */
export const bio = {
  lead: 'from',
  lines: [
    { text: "I'm a developer who treats code as a visual medium — the browser is my canvas, and every interaction is a brushstroke.", highlight: ['code', 'visual', 'medium'] },
    { text: "Nothing holds my attention like the space where engineering meets graphic art. That's where I work.", highlight: ['engineering', 'graphic', 'art'] },
    { text: 'If I ever cash out, I open a studio-lab where young builders prototype the ideas nobody will fund yet.', highlight: ['studio-lab'] },
  ],
  tags: ['full-stack engineer', 'a human', 'of coffee & side projects'],
  available: 'open to select work — 2026',
};

/* Odometer stats */
export const stats = [
  { value: '06', suffix: '+', label: 'years building for the browser' },
  { value: '170', suffix: '+', label: 'sites & platforms shipped in production' },
  { value: '02', suffix: '', label: 'NASA Space Apps global nominations' },
  { value: '10', suffix: 'x', label: 'team velocity via reusable architecture' },
];

/* Tool chips under the stats */
export const tools = ['TypeScript', 'React', 'Three.js', 'Node.js'];

/* Worked-at accordion — real roles from the resume */
export const workedAt = [
  {
    n: '01',
    org: 'SENAI CIMATEC',
    role: 'Front-End Engineer II',
    when: '2023 — NOW',
    desc: 'Component libraries and standardized workflows across modern and legacy stacks. Architecture that raised engineering productivity 10×, WCAG 2.1-compliant interfaces, REST integrations inside distributed systems, and Figma-to-production delivery with designers and back-end engineers in Scrum.',
  },
  {
    n: '02',
    org: 'SENAI CIMATEC',
    role: 'Front-End Engineer I',
    when: '2022 — 23',
    desc: 'Built and evolved 170+ institutional websites and e-learning platforms. Mobile-first responsive interfaces, load-performance optimization and cross-browser parity for a large multi-stakeholder audience.',
  },
  {
    n: '03',
    org: 'NASA SPACE APPS',
    role: 'Global Nominee ×2',
    when: '2024 + 2025',
    desc: 'Twice nominated for global judging. Interactive 3D experiences over real datasets — an asteroid impact simulator and a globe explorer, both built to make hard science legible to a general audience.',
  },
  {
    n: '04',
    org: 'FREELANCE',
    role: 'Full-Stack Developer',
    when: '2020 — 22',
    desc: 'End-to-end web applications with JavaScript, React, C#, TypeScript and Node.js. Responsive, performance-first interfaces — including 3D experiences with Three.js.',
  },
];

/* Connect links — menu overlay + footer */
export const socials = {
  menu: [
    { n: '01', label: 'GitHub', url: 'https://github.com/yurifp' },
    { n: '02', label: 'LinkedIn', url: 'https://www.linkedin.com/in/yuri-ferreira-paulo-86877a183' },
    { n: '03', label: 'Dribbble', url: '#' },
    { n: '04', label: 'Instagram', url: '#' },
  ],
  footer: {
    Work: [
      { label: 'All projects', url: '/work' },
      { label: 'Case studies', url: '/work/impacts' },
    ],
    Elsewhere: [
      { label: 'GitHub', url: 'https://github.com/yurifp' },
      { label: 'LinkedIn', url: 'https://www.linkedin.com/in/yuri-ferreira-paulo-86877a183' },
    ],
  },
};

/* Home grid — 9 scattered artboards. Real projects first, placeholders after.
   accent: signal color of the card frame + connector node. */
export const homeProjects = [
  { slug: 'impacts', title: 'Impacts', cat: 'Case Study', accent: '#64e8ff', w: 460, h: 330, x: 6, y: 0 },
  { slug: 'globeexplorers', title: 'Globe Explorers', cat: 'Case Study', accent: '#905cff', w: 300, h: 420, x: 38, y: 4 },
  { slug: 'this-site', title: 'This Site', cat: 'Web Design', accent: '#9df133', w: 380, h: 280, x: 58, y: 2 },
  { slug: 'aurora-terminal', title: 'Aurora Terminal', cat: 'Web Design', accent: '#f75049', w: 320, h: 240, x: 12, y: 40 },
  { slug: 'tidepool', title: 'Tidepool', cat: 'App Design', accent: '#64e8ff', w: 280, h: 380, x: 36, y: 34 },
  { slug: 'nordwind', title: 'Nordwind Studio', cat: 'Web Design', accent: '#905cff', w: 420, h: 300, x: 56, y: 38 },
  { slug: 'paper-lantern', title: 'Paper Lantern', cat: 'App Design', accent: '#f75049', w: 300, h: 400, x: 8, y: 72 },
  { slug: 'sandbar', title: 'Sandbar Banking', cat: 'App Design', accent: '#9df133', w: 440, h: 310, x: 34, y: 68 },
  { slug: 'static-bloom', title: 'Static Bloom', cat: 'Web Design', accent: '#64e8ff', w: 340, h: 250, x: 60, y: 74 },
];

/* /work page — everything above + the long tail */
export const workPageProjects = [
  ...homeProjects,
  { slug: 'driftwood', title: 'Driftwood', cat: 'Web Design', accent: '#905cff', w: 360, h: 270 },
  { slug: 'paloma', title: 'Paloma', cat: 'App Design', accent: '#f75049', w: 300, h: 400 },
  { slug: 'cortex-analytics', title: 'Cortex Analytics', cat: 'Web Design', accent: '#9df133', w: 420, h: 300 },
];
