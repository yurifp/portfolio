import { defineAction, ActionError } from 'astro:actions';
import { z } from 'astro:schema';
import { Resend } from 'resend';

// process.env first — same runtime-over-build-time rule as src/lib/views.ts
const TO_EMAIL = process.env.RESEND_TO ?? import.meta.env.RESEND_TO ?? 'dev.yurifpaulo@gmail.com';

// Actions need on-demand rendering. The GitHub Pages mirror builds with no
// adapter, so this module exports nothing there — the mirror renders the
// "full version" notice instead of a form pointing at a dead endpoint.
const hasServer = process.env.DEPLOY_TARGET !== 'github';

export const server = hasServer
  ? {
      contact: defineAction({
    accept: 'form',
    input: z.object({
      name: z.string().trim().min(2, 'Name too short — two characters minimum.'),
      email: z.string().trim().email('That e-mail address does not look valid.'),
      message: z.string().trim().min(10, 'Tell me a bit more — ten characters minimum.'),
      // Honeypot: humans never see this field; bots fill it and get a silent ok
      website: z.string().optional(),
    }),
    handler: async (input) => {
      if (input.website) {
        // Bot trapped — acknowledge without sending anything
        return { ok: true, message: 'Thanks.' };
      }

      const apiKey = process.env.RESEND_API_KEY || import.meta.env.RESEND_API_KEY;
      if (!apiKey) {
        console.info(`[contact:dev-mode] ${input.name} <${input.email}> said: ${input.message}`);
        return {
          ok: true,
          message: 'Received in dev mode (RESEND_API_KEY is not set) — logged on the server.',
        };
      }

      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        // Until a domain is verified on Resend, onboarding@resend.dev only
        // delivers to the account owner's own address — see README.
        from: 'Portfolio contact <onboarding@resend.dev>',
        to: [TO_EMAIL],
        replyTo: input.email,
        subject: `Portfolio contact — ${input.name}`,
        text: `${input.message}\n\n—\n${input.name} · ${input.email}`,
      });

      if (error) {
        throw new ActionError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `The e-mail provider refused the send (${error.name}). Reach me directly at ${TO_EMAIL}.`,
        });
      }

      return { ok: true, message: `Thanks, ${input.name}. Message delivered — I'll reply soon.` };
    },
      }),
    }
  : {};
