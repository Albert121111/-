import { existsSync, copyFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options
    });

    child.on('exit', (code) => {
      if (code === 0) resolve(child);
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });

    child.on('error', reject);
  });
}

async function ensureDependencies() {
  const hasRoot = existsSync(path.join(rootDir, 'node_modules'));
  const hasBackend = existsSync(path.join(rootDir, 'backend', 'node_modules'));
  const hasFrontend = existsSync(path.join(rootDir, 'frontend', 'node_modules'));

  if (!hasRoot || !hasBackend || !hasFrontend) {
    console.log('[up] Installing dependencies...');
    await runCommand('npm', ['install']);
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
  await runCommand('npm', ['run', 'migrate', '--workspace', 'backend']);
}

async function startServers() {
  console.log('[up] Starting backend and frontend...');

  const backend = spawn('npm', ['run', 'dev', '--workspace', 'backend'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

  const frontend = spawn('npm', ['run', 'dev', '--workspace', 'frontend'], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });

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
  process.exit(1);
});
