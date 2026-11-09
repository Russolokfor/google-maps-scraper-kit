import {mkdir,cp,rm,readFile,writeFile} from 'node:fs/promises';
await rm('public',{recursive:true,force:true});
await mkdir('public/app',{recursive:true});
await cp('frontend','public/app',{recursive:true});
for(const name of ['index.html','painel.html']) {
 const html=await readFile('frontend/'+name,'utf8');
 await writeFile('public/'+name,html.replace('</body>','<div style="position:fixed;bottom:0;left:0;right:0;background:#182323;color:white;padding:6px 12px;font:12px sans-serif;z-index:9999;text-align:center">MAOF · Nuvem privada · Até 3 termos, profundidade 5 e 5 minutos por busca. Exporte os resultados para guardar uma cópia.</div></body>'));
}
