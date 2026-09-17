import { existsSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Single entry point for both deploy targets:
//   DEPLOY_TARGET unset   -> plain `astro build` (server/Vercel)
//   DEPLOY_TARGET=github  -> park src/actions (Astro hard-errors on actions
//   without a server), alias astro:actions to a stub, build static, restore.
const isStatic = process.env.DEPLOY_TARGET === 'github';

const ACTIONS_DIR = 'src/actions';
const PARKED_DIR = '.actions-parked';

function run() {
  const result = spawnSync('npx', ['astro', 'build'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  process.exitCode = result.status ?? 1;
}

if (!isStatic) {
  run();
} else {
  const parked = existsSync(ACTIONS_DIR);
  if (parked) renameSync(ACTIONS_DIR, PARKED_DIR);
  try {
    run();
  } finally {
    if (parked) renameSync(PARKED_DIR, ACTIONS_DIR);
  }
}
