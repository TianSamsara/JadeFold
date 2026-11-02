const { spawn } = require('node:child_process');
const path = require('node:path');
const vite = spawn(process.execPath, [path.join(__dirname, '../node_modules/vite/bin/vite.js'), '--host', '127.0.0.1'], { stdio: 'inherit' });
let desktop;
const timer = setInterval(async () => {
  try {
    const response = await fetch('http://127.0.0.1:5173');
    if (!response.ok) return;
    clearInterval(timer);
    const env = { ...process.env, FRAME_DEV_URL: 'http://127.0.0.1:5173' };
    delete env.ELECTRON_RUN_AS_NODE;
    desktop = spawn(require('electron'), ['.'], { stdio: 'inherit', env });
    desktop.on('exit', () => { vite.kill(); process.exit(); });
  } catch {}
}, 500);
process.on('SIGINT', () => { clearInterval(timer); desktop?.kill(); vite.kill(); process.exit(); });
