const { spawn } = require('child_process');

console.log('[Launcher] Starting local proxy and web dev server...');

// Start proxy
const proxy = spawn('node', ['proxy.js'], { stdio: 'inherit', shell: true });

// Start lite-server
const devServer = spawn('npx', ['lite-server'], { stdio: 'inherit', shell: true });

// Forward SIGINT / SIGTERM to child processes
const cleanup = () => {
  console.log('[Launcher] Cleaning up child processes...');
  try {
    proxy.kill();
  } catch (e) {}
  try {
    devServer.kill();
  } catch (e) {}
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);
