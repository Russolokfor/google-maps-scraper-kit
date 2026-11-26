import { Sandbox } from '@vercel/sandbox';

const SCRAPER_VERSION = 'v1.21.0';
const SCRAPER_BIN = '/vercel/sandbox/bin/google_maps_scraper-1.21.0-linux-amd64';
const DATA_DIR = '/vercel/sandbox/mapsdata';
const LOG_FILE = '/vercel/sandbox/google-maps-scraper.log';
const INSTALL_LOG = '/vercel/sandbox/google-maps-scraper-install.log';
const INSTALL_MARKER = '/vercel/sandbox/.maps-engine-installed-v1.21.0';
const PLAYWRIGHT_ENV = {
  PLAYWRIGHT_BROWSERS_PATH: '/vercel/sandbox/.cache/ms-playwright',
  PLAYWRIGHT_DRIVER_PATH: '/vercel/sandbox/.cache/ms-playwright-go',
  DEBIAN_FRONTEND: 'noninteractive'
};

const runChecked = async (sandbox, cmd, args, options = {}) => {
  const result = await sandbox.runCommand({ cmd, args, env: PLAYWRIGHT_ENV, ...options });
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    throw new Error(`${cmd} failed (${result.exitCode}): ${stderr.slice(-3000)}`);
  }
  return result;
};

// Install asynchronously: the frontend polls this endpoint every few seconds,
// so a long apt/Playwright install must not hold a serverless request open.
const installEngine = async (sandbox) => {
  const check = await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', `test -x "${SCRAPER_BIN}" && test -f "${INSTALL_MARKER}"`],
    env: PLAYWRIGHT_ENV
  });
  if (check.exitCode === 0) return true;

  const installScript = [
    'set -euo pipefail',
    'mkdir -p /vercel/sandbox/bin /vercel/sandbox/mapsdata /vercel/sandbox/.cache/ms-playwright /vercel/sandbox/.cache/ms-playwright-go',
    'sudo env DEBIAN_FRONTEND=noninteractive apt-get update',
    'sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl libnss3 libnspr4 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libdbus-1-3 libxkbcommon0 libatspi2.0-0t64 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64',
    `curl -fsSL https://raw.githubusercontent.com/gosom/google-maps-scraper/${SCRAPER_VERSION}/install.sh -o /vercel/sandbox/install-google-maps-scraper.sh`,
    `bash /vercel/sandbox/install-google-maps-scraper.sh --version ${SCRAPER_VERSION} --install-dir /vercel/sandbox/bin`,
    `"${SCRAPER_BIN}" -version | grep -F "${SCRAPER_VERSION}"`,
    `touch "${INSTALL_MARKER}"`
  ].join(' && ');

  const command = 'flock -n /tmp/maof-scraper-install.lock bash -lc ' +
    JSON.stringify(installScript) +
    ' >> ' + JSON.stringify(INSTALL_LOG) + ' 2>&1';

  // Non-blocking lock prevents parallel page polls from starting duplicate
  // apt installs. The detached installer continues after this HTTP request.
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    env: PLAYWRIGHT_ENV,
    detached: true
  });
  return false;
};

const startEngine = async (sandbox) => {
  const installed = await installEngine(sandbox);
  if (!installed) return false;

  const health = await sandbox.runCommand('curl', [
    '-fsS',
    '--max-time', '3',
    'http://127.0.0.1:8080/api/v1/jobs'
  ]);
  if (health.exitCode === 0) return true;

  const startupScript = [
    'if curl -fsS --max-time 3 http://127.0.0.1:8080/api/v1/jobs >/dev/null; then exit 0; fi',
    `nohup "${SCRAPER_BIN}" -web -addr 127.0.0.1:8080 -data-folder "${DATA_DIR}" >> "${LOG_FILE}" 2>&1 </dev/null &`,
    'for i in {1..45}; do if curl -fsS --max-time 3 http://127.0.0.1:8080/api/v1/jobs >/dev/null; then exit 0; fi; sleep 1; done',
    'echo "Scraper did not become healthy after startup."',
    'tail -n 80 "' + LOG_FILE + '" 2>/dev/null || true',
    'exit 1'
  ].join('; ').replace(' &; for', ' & for');

  const command = 'flock -n /tmp/maof-scraper-start.lock bash -lc ' +
    JSON.stringify(startupScript) +
    ' >> ' + JSON.stringify(LOG_FILE + '.startup') + ' 2>&1';

  // Startup also runs detached and under a non-blocking lock. The next poll
  // will see the healthy endpoint and proceed with the requested operation.
  await sandbox.runCommand({
    cmd: 'bash',
    args: ['-lc', command],
    env: PLAYWRIGHT_ENV,
    detached: true
  });
  return false;
};

const getEngine = async () => {
  const sandbox = await Sandbox.getOrCreate({
    name: 'maps-engine',
    resume: true,
    timeout: 900_000
  });
  const ready = await startEngine(sandbox);
  return { sandbox, ready };
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
    const { sandbox, ready } = await getEngine();
    if (!ready) {
      res.setHeader('Retry-After', '5');
      return res.status(503).json({
        message: 'O motor está sendo preparado. Aguarde alguns segundos e tente novamente.'
      });
    }

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
