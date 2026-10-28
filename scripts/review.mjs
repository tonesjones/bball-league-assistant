import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { reviewState, saveRatings, recordBriefCopy } from '../src/sources/review-ui.mjs';
import { validDecisionId } from '../src/sources/decisions.mjs';

const script = fileURLToPath(import.meta.url);
const defaultRoot = path.resolve(path.dirname(script), '..');
const assets = path.join(defaultRoot, 'src/ui');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startReviewServer({ root = defaultRoot, token = randomBytes(32).toString('hex') } = {}) {
  let origin;
  let writing = Promise.resolve();
  const server = createServer(async (req, res) => {
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      if (req.headers.host !== new URL(origin).host || req.headers.origin && req.headers.origin !== origin) return json(403, { error: 'This screen is available only from its local address.' });
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith('/api/')) {
        if (req.headers.authorization !== `Bearer ${token}`) return json(403, { error: 'Open this screen using the link from npm run review.' });
        if (req.method === 'GET' && url.pathname === '/api/health') return json(200, { root });
        if (req.method === 'GET' && url.pathname === '/api/state') return json(200, await reviewState(root, url.searchParams.get('decision')));
        if (req.method !== 'POST' || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return json(403, { error: 'Invalid local request.' });
        req.setEncoding('utf8');
        let body = '';
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 20000) return json(413, { error: 'Request too large.' }); }
        const input = JSON.parse(body);
        // Serialize writes from tabs so a double click/retry does not duplicate reviews.
        const operation = () => url.pathname === '/api/ratings' ? saveRatings(root, input.decisionId, input.ratings)
          : url.pathname === '/api/copied' ? recordBriefCopy(root, input.decisionId) : Promise.reject(new Error('Unknown action'));
        const result = writing.then(operation);
        writing = result.catch(() => {});
        return json(200, await result);
      }
      const files = { '/': ['review.html', 'text/html'], '/review.js': ['review.js', 'text/javascript'], '/review.css': ['review.css', 'text/css'] };
      const asset = files[url.pathname];
      if (req.method !== 'GET' || !asset) return json(404, { error: 'Not found' });
      const content = await readFile(path.join(assets, asset[0]));
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); res.end(content);
    } catch (e) { json(400, { error: e.code === 'ENOENT' ? 'The requested decision or input file is missing.' : e.message }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, origin, token, root };
}

async function launch(args) {
  const serve = args.includes('--serve'), noOpen = args.includes('--no-open');
  const positional = args.filter((arg) => !['--serve', '--no-open'].includes(arg));
  if (positional.length > 1 || positional[0] && !validDecisionId(positional[0])) throw new Error('Usage: npm run review -- [decisionId] [--no-open]');
  const id = positional[0], root = defaultRoot, dir = path.join(root, 'local/review-ui');
  await mkdir(dir, { recursive: true });
  const descriptor = path.join(dir, 'server.json');
  if (serve) {
    const service = await startReviewServer({ root });
    await writeFile(descriptor, JSON.stringify({ origin: service.origin, token: service.token, root, pid: process.pid }));
    return;
  }
  // Select an exact decision before opening; refresh callers always pass the current ID.
  const state = await reviewState(root, id);
  const selectedId = state.selected?.id;
  let service;
  try {
    const saved = JSON.parse(await readFile(descriptor, 'utf8'));
    const address = new URL(saved.origin);
    if (saved.root === root && address.protocol === 'http:' && address.hostname === '127.0.0.1') {
      const result = await fetch(`${saved.origin}/api/health`, { headers: { Authorization: `Bearer ${saved.token}` }, signal: AbortSignal.timeout(1000) });
      if (result.ok && (await result.json()).root === root) service = saved;
    }
  } catch { /* A stopped server is restarted below. */ }
  if (!service) {
    const log = await open(path.join(dir, 'server.log'), 'a');
    const child = spawn(process.execPath, [script, '--serve'], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
    let launchError;
    child.once('error', (e) => { launchError = e; });
    child.unref(); await log.close();
    for (let i = 0; i < 50; i++) {
      if (launchError) throw launchError;
      await delay(100);
      try {
        const saved = JSON.parse(await readFile(descriptor, 'utf8'));
        if (saved.pid === child.pid) { service = saved; break; }
      } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    }
    if (!service) throw new Error('Review screen did not start. See local/review-ui/server.log.');
  }
  const url = `${service.origin}/${selectedId ? `?decision=${encodeURIComponent(selectedId)}` : ''}#${service.token}`;
  if (!noOpen) {
    const executable = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    const openArgs = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
    const child = spawn(executable, openArgs, { detached: true, windowsHide: true, stdio: 'ignore' });
    child.on('error', (e) => console.error(`Could not open the browser: ${e.message}. Use the local link below.`)); child.unref();
  }
  console.log(`League review: ${url}`);
  console.log('The link is private to this computer. Ratings are saved to local/pilot-reviews.jsonl.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  launch(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
