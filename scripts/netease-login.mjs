// Optional local QR login for the installed Aurabot; no credential is printed or saved by this helper.
import { existsSync, statSync, unlinkSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length !== 4) {
  console.error('Usage: node netease-login.mjs <loopback-api-base> <plugin-dir> <qr-image.png> <venv-python>');
  process.exit(2);
}
const [base, pluginDir, image, python] = args;
if (!/^http:\/\/127\.0\.0\.1:\d+\/aurabot\/api$/.test(base) ||
    ![pluginDir, image, python].every(isAbsolute) || !image.toLowerCase().endsWith('.png') ||
    !existsSync(pluginDir) || !statSync(pluginDir).isDirectory() ||
    !existsSync(python) || !statSync(python).isFile() || existsSync(image)) {
  console.error('Invalid API, plugin, Python, or output path (the PNG must not already exist).');
  process.exit(2);
}
const modulePath = join(pluginDir, 'src', 'song', 'netease.js');
if (!existsSync(modulePath)) throw new Error('Unsupported Aurabot: netease.js not found');
const { weapi, account } = await import(pathToFileURL(modulePath).href);
if (typeof weapi !== 'function' || typeof account !== 'function') throw new Error('Unsupported Aurabot interface');
let createdImage = false;
async function post(path, data) {
  const r = await fetch('https://music.163.com/weapi' + path, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
      referer: 'https://music.163.com/', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      cookie: 'os=pc; appver=3.0.0' },
    body: new URLSearchParams(weapi({ ...data, csrf_token: '' })),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error('Netease HTTP ' + r.status);
  if (typeof r.headers.getSetCookie !== 'function') throw new Error('Node runtime lacks getSetCookie support');
  return { body: await r.json(), cookies: r.headers.getSetCookie() };
}
try {
  const local = await fetch(base + '/song/account', { signal: AbortSignal.timeout(25000) });
  if (!local.ok) throw new Error('Local Aurabot unavailable');
  if ((await local.json()).ok) {
    console.log('LOGIN_STATE=already_logged_in');
    process.exit(0);
  }
  const first = await post('/login/qrcode/unikey', { type: 3 });
  if (first.body.code !== 200 || !first.body.unikey) throw new Error('QR key unavailable');
  const qrUrl = 'https://music.163.com/login?codekey=' + encodeURIComponent(first.body.unikey);
  const qrPython = 'import sys,qrcode; im=qrcode.make(sys.stdin.read().strip()); f=open(sys.argv[1],"xb"); im.save(f,format="PNG"); f.close()';
  await new Promise((resolve, reject) => {
    const py = spawn(python, ['-I', '-c', qrPython, image], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    py.on('error', reject);
    py.on('exit', code => code === 0 ? resolve() : reject(new Error('QR generation failed; check qrcode and Pillow in this Python environment')));
    py.stdin.on('error', () => {});
    py.stdin.end(qrUrl);
  });
  createdImage = true;
  console.log('LOGIN_STATE=waiting_for_scan');
  console.log('QR_IMAGE=' + image);
  const deadline = Date.now() + 240000;
  let previous = 801;
  let failures = 0;
  let completed = false;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 3000));
    let result;
    try { result = await post('/login/qrcode/client/login', { key: first.body.unikey, type: 3 }); failures = 0; }
    catch { if (++failures >= 3) throw new Error('QR polling network failed'); else continue; }
    const code = result.body.code;
    if (code === 800) { console.log('LOGIN_STATE=expired'); process.exitCode = 2; break; }
    if (code === 802 && code !== previous) console.log('LOGIN_STATE=waiting_for_phone_confirmation');
    if (code === 803) {
      const token = result.cookies.map(c => c.match(/(?:^|;\s*)MUSIC_U=([^;\s]+)/)?.[1]).find(Boolean);
      if (!token) throw new Error('Login response did not include MUSIC_U');
      if (!(await account(token)).ok) throw new Error('Account verification failed; credential not saved');
      const saved = await fetch(base + '/save', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ song: { neteaseCookie: token } }), signal: AbortSignal.timeout(15000) });
      if (!saved.ok || (await saved.json()).ok === false) throw new Error('Local save failed');
      const confirmed = await fetch(base + '/song/account', { signal: AbortSignal.timeout(25000) });
      if (!confirmed.ok || !(await confirmed.json()).ok) throw new Error('Saved login could not be verified');
      console.log('LOGIN_STATE=saved_and_verified');
      completed = true;
      break;
    }
    if (![801, 802].includes(code)) throw new Error('Unexpected QR status');
    previous = code;
  }
  if (!completed && Date.now() >= deadline && process.exitCode !== 2) { console.log('LOGIN_STATE=expired'); process.exitCode = 2; }
} catch (error) {
  console.error('LOGIN_STATE=failed');
  console.error(error.message?.startsWith('fetch') ? 'Login network request failed' : error.message);
  process.exitCode = 1;
} finally {
  // The QR image is an active login credential. Never delete a pre-existing file.
  if (createdImage) try { unlinkSync(image); } catch { console.error('Remove the expired QR image manually.'); }
}
