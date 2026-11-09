import { Sandbox } from '@vercel/sandbox';

const start = async (s) => {
  const command = await s.runCommand({cmd:'bash', args:['-lc', 'curl -sf http://127.0.0.1:8080/api/v1/jobs >/dev/null || (nohup /vercel/scraper -web -addr 127.0.0.1:8080 -data-folder /vercel/mapsdata >> /vercel/scraper.log 2>&1 </dev/null &)' ]});
  if(command.exitCode !== 0) throw new Error('Não foi possível iniciar o motor.');
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
  const path = (new URL(req.url,'http://localhost').searchParams.get('path') || '/api/v1/jobs').replace(/\/$/, '');
  if(!/^\/api\/v1\/jobs(?:\/[a-f0-9-]+(?:\/download)?)?$/.test(path) || !['GET','POST','DELETE'].includes(req.method)) return res.status(400).json({message:'Operação inválida.'});
  if(req.method==='POST' && path!=='/api/v1/jobs') return res.status(405).end();
  try {
    const s = await Sandbox.get({name:'maps-engine',resume:true,onResume:start});
    await start(s);
    let body=null;
    if(req.method==='POST') {
      const input=typeof req.body==='string'?JSON.parse(req.body):req.body;
      if(!input || !Array.isArray(input.keywords) || input.keywords.length<1 || input.keywords.length>3 || input.keywords.some(k=>typeof k!=='string'||k.length>200)) return res.status(400).json({message:'Use entre 1 e 3 termos por busca.'});
      body=JSON.stringify({...input,depth:Math.min(5,Math.max(1,Number(input.depth)||1)),max_time:Math.min(300,Math.max(60,Number(input.max_time)||300))});
    }
    const command=await s.runCommand('python3',['-c',bridge,JSON.stringify({path,method:req.method,body})]);
    if(command.exitCode!==0) throw new Error((await command.stderr()).slice(-1000));
    const result=JSON.parse(await command.stdout());
    res.setHeader('Content-Type',result.type);
    res.status(result.status).send(Buffer.from(result.body,'base64'));
  } catch(error) {
    console.error('scraper bridge:',error.message);
    res.status(503).json({message:'O motor não respondeu. Aguarde alguns segundos e tente novamente.',detail:error.message.slice(0,300)});
  }
}
