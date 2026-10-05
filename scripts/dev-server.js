import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const launch = (command, args) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', code => {
    if (!stopping) {
      stopping = true;
      for (const other of children) if (other !== child) other.kill('SIGTERM');
      process.exitCode = code || 0;
    }
  });
};
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
});
launch(process.execPath, ['server/index.js']);
launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0']);
