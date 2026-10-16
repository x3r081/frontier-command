import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const children = [];
const launch = (command, args, env) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', env });
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

// Let the OS pick a currently available port by binding the same wildcard
// interface as the backend. The socket is released before the children start;
// this brief handoff is the only portable way to share a dynamically selected
// port with both processes without changing the backend's startup contract.
const findFreePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '0.0.0.0', () => {
    const { port } = probe.address();
    probe.close(error => error ? reject(error) : resolve(port));
  });
});

try {
  const explicitPort = process.env.PORT;
  const requestedPort = explicitPort === undefined || explicitPort === ''
    ? undefined
    : Number(explicitPort);
  if (requestedPort !== undefined &&
      (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535)) {
    throw new Error(`Invalid PORT value: ${explicitPort}`);
  }
  const port = String(requestedPort > 0 ? requestedPort : await findFreePort());
  const env = { ...process.env, PORT: port };
  launch(process.execPath, ['server/index.js'], env);
  launch(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0'], env);
} catch (error) {
  console.error(`Could not select a backend port: ${error.message}`);
  process.exitCode = 1;
}
