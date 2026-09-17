// Static-mirror stand-in for the astro:actions module: the mirror never calls
// actions (the form is replaced by a notice), but the module graph still needs
// a resolvable import. Wired via vite.resolve.alias when DEPLOY_TARGET=github.
export const actions = {};
