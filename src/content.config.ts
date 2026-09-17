import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      role: z.string(),
      stack: z.array(z.string()),
      year: z.number(),
      links: z.object({ repo: z.string().url().optional(), live: z.string().url().optional() }),
      cover: image().optional(),
      featured: z.boolean().default(false),
      // Filter tags — the island derives its chips from these
      tags: z.array(z.enum(['3d', 'frontend', 'fullstack', 'ai'])).default([]),
      // Concrete, verifiable facts shown inside the expanded case
      metrics: z.array(z.object({ label: z.string(), value: z.string() })).default([]),
    }),
});

export const collections = { projects };
