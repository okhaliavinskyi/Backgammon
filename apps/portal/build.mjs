import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dist = fileURLToPath(new URL('./dist/', import.meta.url));
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const build = spawnSync('npm', ['run', 'build', '-w', '@nardy/web', '--', '--base=/backgammon/', '--outDir', dist + 'backgammon'], { cwd: root, stdio: 'inherit' });
if (build.status !== 0) process.exit(build.status ?? 1);
cpSync(new URL('./public/', import.meta.url), dist, { recursive: true });

const games = JSON.parse(readFileSync(new URL('./games.json', import.meta.url), 'utf8'));
const shell = readFileSync(new URL('./shell.html', import.meta.url), 'utf8');
for (const game of games) {
  mkdirSync(dist + game.slug, { recursive: true });
  writeFileSync(dist + game.slug + '/index.html', shell.replaceAll('__NAME__', game.name).replaceAll('__DESCRIPTION__', game.description).replaceAll('__SLUG__', game.slug));
}
