import { existsSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function resolveNpmInvocation() {
  // Most reliable under npm run on all OSes (especially Windows):
  // execute npm CLI script via current node runtime.
  const npmCli = process.env.npm_execpath;
  if (npmCli && existsSync(npmCli)) {
    return { command: process.execPath, baseArgs: [npmCli] };
  }

  // Fallback for direct invocation outside npm context.
  return process.platform === 'win32'
    ? { command: 'npm.cmd', baseArgs: [] }
    : { command: 'npm', baseArgs: [] };
}

const npmInvoke = resolveNpmInvocation();

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: false,
      ...options
    });

    child.on('exit', (code) => {
      if (code === 0) resolve(child);
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

function runNpm(args, options = {}) {
  return runCommand(npmInvoke.command, [...npmInvoke.baseArgs, ...args], options);
}

function spawnNpm(args, options = {}) {
  return spawn(npmInvoke.command, [...npmInvoke.baseArgs, ...args], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    ...options
  });
}

async function ensureDependencies() {
  const hasRoot = existsSync(path.join(rootDir, 'node_modules'));
  const hasBackend = existsSync(path.join(rootDir, 'backend', 'node_modules'));
  const hasFrontend = existsSync(path.join(rootDir, 'frontend', 'node_modules'));

  if (!hasRoot || !hasBackend || !hasFrontend) {
    console.log('[up] Installing dependencies...');
    await runNpm(['install']);
  }
}

function ensureEnvFile() {
  const envPath = path.join(rootDir, '.env');
  const examplePath = path.join(rootDir, '.env.example');
  if (!existsSync(envPath) && existsSync(examplePath)) {
    copyFileSync(examplePath, envPath);
    console.log('[up] Created .env from .env.example. Fill MAPILLARY_TOKEN and VITE_MAPILLARY_TOKEN.');
  }
}

async function runMigrations() {
  console.log('[up] Running DB migrations...');
  await runNpm(['run', 'migrate', '--workspace', 'backend']);
}

async function startServers() {
  console.log('[up] Starting backend and frontend...');

  const backend = spawnNpm(['run', 'dev', '--workspace', 'backend']);
  const frontend = spawnNpm(['run', 'dev', '--workspace', 'frontend']);

  const cleanup = () => {
    if (!backend.killed) backend.kill('SIGTERM');
    if (!frontend.killed) frontend.kill('SIGTERM');
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  await Promise.all([
    new Promise((resolve, reject) => {
      backend.on('exit', (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`backend exited with code ${code}`));
      });
      backend.on('error', reject);
    }),
    new Promise((resolve, reject) => {
      frontend.on('exit', (code) => {
        if (code === 0 || code === null) resolve();
        else reject(new Error(`frontend exited with code ${code}`));
      });
      frontend.on('error', reject);
    })
  ]);
}

async function main() {
  await ensureDependencies();
  ensureEnvFile();
  await runMigrations();
  await startServers();
}

main().catch((error) => {
  console.error('[up] Failed to start project:', error.message);
  if (process.platform === 'win32' && /EINVAL/i.test(String(error?.message || ''))) {
    console.error('[up] Windows hint: run from plain path without special shell wrappers and ensure Node 22+ is installed.');
  }
  process.exit(1);
});
