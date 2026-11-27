// Build the client and publish it to the gh-pages branch (GitHub Pages serves that branch).
// Usage: node scripts/deploy-pages.mjs wss://your-server.onrender.com
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = process.argv[2] || process.env.VITE_SERVER_URL;
if (!server || !/^wss?:\/\//.test(server)) {
  console.error('Pass the game server URL, e.g. node scripts/deploy-pages.mjs wss://last-ride-sg.onrender.com');
  process.exit(1);
}
const run = (cmd, opts = {}) => execSync(cmd, { stdio: 'inherit', ...opts });
const remote = execSync('git remote get-url origin').toString().trim();
const name = execSync('git config user.name').toString().trim();
const email = execSync('git config user.email').toString().trim();

run('npx vite build', { env: { ...process.env, VITE_SERVER_URL: server } });
const dir = mkdtempSync(join(tmpdir(), 'last-ride-pages-'));
try {
  cpSync('dist', dir, { recursive: true });
  writeFileSync(join(dir, '.nojekyll'), '');
  // the offline copy's version (public/sw.js): every deploy is a new one, so players' copies check for changes
  const sw = join(dir, 'sw.js');
  const version = `${execSync('git rev-parse --short HEAD').toString().trim()}-${Date.now().toString(36)}`;
  writeFileSync(sw, readFileSync(sw, 'utf8').replace('__SW_VERSION__', version));
  run('git init -q -b gh-pages', { cwd: dir });
  run(`git -c user.name="${name}" -c user.email="${email}" add -A`, { cwd: dir });
  run(`git -c user.name="${name}" -c user.email="${email}" commit -q -m "Deploy LAST RIDE client"`, { cwd: dir });
  run(`git push -f "${remote}" gh-pages`, { cwd: dir });
  console.log('Published to gh-pages');
} finally {
  rmSync(dir, { recursive: true, force: true });
}
