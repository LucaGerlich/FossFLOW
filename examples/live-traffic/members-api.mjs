// A stand-in for an outside SaaS: it has no OpenTelemetry, so FossFLOW sees it only through its callers.
import http from 'node:http';

const MODES = ['ok', 'failing', 'slow'];
let mode = 'ok';

const between = (min, max) => min + Math.random() * (max - min);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const modeMatch = /^\/admin\/mode\/([a-z]+)$/.exec(pathname);

  if (req.method === 'POST' && modeMatch && MODES.includes(modeMatch[1])) {
    mode = modeMatch[1];
    console.log(`mode: ${mode}`);
    res.writeHead(204).end();
    return;
  }

  const memberMatch = /^\/members\/([^/]+)$/.exec(pathname);
  if (req.method === 'GET' && memberMatch) {
    await sleep(between(20, 80) + (mode === 'slow' ? between(1200, 2000) : 0));
    if (mode === 'failing' && Math.random() < 0.6) {
      res.writeHead(503).end();
      return;
    }
    const id = Number(memberMatch[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: Number.isNaN(id) ? memberMatch[1] : id, plan: 'flex' }));
    return;
  }

  res.writeHead(404).end();
});

server.listen(4010, () => console.log('members-api listening on 4010'));
