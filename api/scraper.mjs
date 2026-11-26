import { Sandbox } from '@vercel/sandbox';

const SCRAPER_VERSION = 'v1.21.0';
const SCRAPER_BIN = '/vercel/sandbox/bin/google_maps_scraper-1.21.0-linux-amd64';
const DATA_DIR = '/vercel/sandbox/mapsdata';
const LOG_FILE = '/vercel/sandbox/google-maps-scraper.log';
const PLAYWRIGHT_ENV = {
  PLAYWRIGHT_BROWSERS_PATH: '/vercel/sandbox/.cache/ms-playwright',
  PLAYWRIGHT_DRIVER_PATH: '/vercel/sandbox/.cache/ms-playwright-go'
};

const runChecked = async (sandbox, cmd, args, options = {}) => {
  const result = await sandbox.runCommand({ cmd, args, env: PLAYWRIGHT_ENV, ...options });
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    throw new Error(`${cmd} failed (${result.exitCode}): ${stderr.slice(-3000)}`);
  }
  return result;
};

// Mirrors the upstream project's supported Linux installation path:
// verified release binary + Playwright browser runtime + native Linux libraries.
const installEngine = async (sandbox) => {
  const script = [
    'set -euo pipefail',
    'mkdir -p /vercel/sandbox/bin /vercel/sandbox/mapsdata /vercel/sandbox/.cache/ms-playwright /vercel/sandbox/.cache/ms-playwright-go',
    'flock /tmp/maof-scraper-install.lock bash -lc ' + JSON.stringify([
      'set -euo pipefail',
      `if test -x "${SCRAPER_BIN}" && test -f /vercel/sandbox/.maps-engine-installed-v1.21.0; then exit 0; fi`,
      'sudo apt-get update',
      'sudo apt-get install -y ca-certificates curl libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0t64 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64',
      `curl -fsSL https://raw.githubusercontent.com/gosom/google-maps-scraper/${SCRAPER_VERSION}/install.sh -o /vercel/sandbox/install-google-maps-scraper.sh`,
      'bash /vercel/sandbox/install-google-maps-scraper.sh --version ' + SCRAPER_VERSION + ' --install-dir /vercel/sandbox/bin',
      'touch /vercel/sandbox/.maps-engine-installed-v1.21.0'
    ].join(' && '))
  ].join(' && ');

  await runChecked(sandbox, 'bash', ['-lc', script]);

  const version = await sandbox.runCommand({
    cmd: SCRAPER_BIN,
    args: ['-version'],
    env: PLAYWRIGHT_ENV
  });
  if (version.exitCode !== 0 || !(await version.stdout()).trim().includes(SCRAPER_VERSION)) {
    throw new Error('A versão instalada do Google Maps Scraper não passou na validação.');
  }
};


const startEngine = async (sandbox) => {
  await installEngine(sandbox);

  const script = [
    'set -euo pipefail',
    'flock /tmp/maof-scraper-start.lock bash -lc ' + JSON.stringify([
      'if curl -fsS --max-time 3 http://127.0.0.1:8080/api/v1/jobs >/dev/null; then exit 0; fi',
      `nohup "${SCRAPER_BIN}" -web -addr 127.0.0.1:8080 -data-folder "${DATA_DIR}" >> "${LOG_FILE}" 2>&1 </dev/null &`,
      'for i in $(seq 1 45); do if curl -fsS --max-time 3 http://127.0.0.1:8080/api/v1/jobs >/dev/null; then exit 0; fi; sleep 1; done',
      'echo "Scraper did not become healthy. Recent engine log:"',
      'tail -n 80 "' + LOG_FILE + '" 2>/dev/null || true',
      'exit 1'
    ].join('\\n'))
  ].join(' && ');

  await runChecked(sandbox, 'bash', ['-lc', script]);
};

// The scraper process does not survive a Sandbox session stop. Reinstall only
// when its files are absent, and start + health-check it on every new session.
const getEngine = async () => {
  const sandbox = await Sandbox.getOrCreate({
    name: 'maps-engine',
    resume: true,
    timeout: 900_000
  });

  // Lifecycle hooks alone are insufficient: a session can remain active after
  // its child process exits. Verify/restart the engine on every API request.
  await startEngine(sandbox);
  return sandbox;
};

// Only calls the private, fixed loopback service. No ports are exposed publicly.
const bridge = `import sys,json,urllib.request,urllib.error,base64
p=json.loads(sys.argv[1])
r=urllib.request.Request('http://127.0.0.1:8080'+p['path'],data=p['body'].encode() if p['body'] is not None else None,headers={'Content-Type':'application/json'},method=p['method'])
try:
 s=urllib.request.urlopen(r,timeout=30)
except urllib.error.HTTPError as e:
 s=e
b=s.read(3000001)
if len(b)>3000000: raise ValueError('Arquivo excede o limite de 3 MB desta interface')
print(json.dumps({'status':s.status,'type':s.headers.get('Content-Type','application/json'),'body':base64.b64encode(b).decode()}))`;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  const path = (new URL(req.url, 'http://localhost').searchParams.get('path') || '/api/v1/jobs').replace(/\/$/, '');
  if (!/^\/api\/v1\/jobs(?:\/[a-f0-9-]+(?:\/download)?)?$/.test(path) || !['GET', 'POST', 'DELETE'].includes(req.method)) {
    return res.status(400).json({ message: 'Operação inválida.' });
  }
  if (req.method === 'POST' && path !== '/api/v1/jobs') return res.status(405).end();

  try {
    const sandbox = await getEngine();
    let body = null;

    if (req.method === 'POST') {
      const input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!input || !Array.isArray(input.keywords) || input.keywords.length < 1 || input.keywords.length > 3 ||
          input.keywords.some(k => typeof k !== 'string' || k.trim().length === 0 || k.length > 200)) {
        return res.status(400).json({ message: 'Use entre 1 e 3 termos válidos por busca.' });
      }

      body = JSON.stringify({
        ...input,
        fast_mode: true,
        depth: Math.min(5, Math.max(1, Number(input.depth) || 1)),
        max_time: Math.min(300, Math.max(180, Number(input.max_time) || 300))
      });
    }

    const command = await sandbox.runCommand('python3', ['-c', bridge, JSON.stringify({
      path,
      method: req.method,
      body
    })]);

    if (command.exitCode !== 0) {
      throw new Error((await command.stderr()).slice(-3000) || 'Falha na comunicação com o motor.');
    }

    const result = JSON.parse(await command.stdout());
    res.setHeader('Content-Type', result.type);
    return res.status(result.status).send(Buffer.from(result.body, 'base64'));
  } catch (error) {
    console.error('scraper bridge:', error?.stack || error?.message || String(error));
    return res.status(503).json({
      message: 'O motor de pesquisa está indisponível. Tente novamente em instantes.'
    });
  }
}
