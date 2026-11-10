import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../frontend/google-sheets.js',import.meta.url),'utf8');
const rows=[['=IMPORTXML(1)','Barbearia','+5562999999999','https://wa.me/5562999999999','','https://example.com','4,8','20','Goiânia','https://maps.google.com']];
function environment({deny=false,failFormatting=false}={}) {
 const calls=[];let destination=null,consents=0;
 const element=()=>({style:{},setAttribute(){},appendChild(){},replaceChildren(){},remove(){}});
 const context={console,Date,Number,Array,String,parseInt,Promise,Error,
  localStorage:{getItem:()=> '123-test.apps.googleusercontent.com'},
  document:{querySelectorAll:()=>[],getElementById:()=>null,createElement:element,createTextNode:()=>({}),body:{appendChild(){}}},
  location:{assign:url=>{destination=url;}},
  google:{accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:options=>({requestAccessToken:()=>{consents++;options.callback(deny?{error:'access_denied'}:{access_token:'memory-only-test',expires_in:3600});}})}}},
  fetch:async(url,options)=>{
   calls.push({url,...options,body:options.body?JSON.parse(options.body):null});
   if(failFormatting && url.endsWith(':batchUpdate')) return {ok:false,status:403,json:async()=>({error:{message:'Formatting denied'}})};
   const json=url.endsWith(':batchUpdate')?{}:options.method==='POST'?{spreadsheetId:'test-sheet-123'}:{sheets:[{properties:{gridProperties:{frozenRowCount:1}},basicFilter:{range:{}},data:[{rowData:[{}, {values:Array.from({length:11},(_,i)=>i===10?{dataValidation:{condition:{type:'ONE_OF_LIST'}}}:{})}]}]}]};
   return {ok:true,status:200,json:async()=>json};
  }
 };
 vm.createContext(context);vm.runInContext(source,context);
 return {api:context.MaofSheets,calls,destination:()=>destination,consents:()=>consents};
}
const success=environment();await success.api.export('Barbearias Goiânia',rows);
assert.equal(success.calls.length,3);assert.equal(success.consents(),1);
const file=success.calls[0].body,sheet=file.sheets[0],cells=sheet.data[0].rowData[1].values;
assert.equal(sheet.properties.gridProperties.frozenRowCount,1);
assert.equal(sheet.data[0].rowData[0].values.length,15);
assert.equal(cells[0].userEnteredValue.stringValue,'=IMPORTXML(1)','Untrusted business names must never become formulas');
assert.equal(cells[2].userEnteredValue.stringValue,'+5562999999999','Phone must retain prefix and digits');
assert.equal(cells[6].userEnteredValue.numberValue,4.8);assert.equal(cells[7].userEnteredValue.numberValue,20);
assert.equal(cells[10].userEnteredValue.stringValue,'Não contatado');
const requests=success.calls[1].body.requests;
const validation=requests.find(x=>x.setDataValidation).setDataValidation;
assert.equal(validation.range.startColumnIndex,10);assert.equal(validation.range.endColumnIndex,11);assert.equal(validation.rule.strict,true);
assert(validation.rule.condition.values.some(x=>x.userEnteredValue==='Respondeu'));
assert(validation.rule.condition.values.some(x=>x.userEnteredValue==='Não respondeu'));
assert.equal(success.destination(),'https://docs.google.com/spreadsheets/d/test-sheet-123/edit');
const denied=environment({deny:true});await denied.api.export('Teste',rows);assert.equal(denied.calls.length,0);assert.equal(denied.destination(),null);
const incomplete=environment({failFormatting:true});await incomplete.api.export('Teste',rows);assert.equal(incomplete.calls.length,2);assert.equal(incomplete.destination(),null,'Must not auto-open an incompletely formatted sheet');
assert.throws(()=>success.api.buildSpreadsheet('Teste',[]),/Nenhuma empresa/);
for(const file of ['app','painel']) {
 const body=await readFile(new URL('../frontend/'+file+'.js',import.meta.url),'utf8');assert(body.includes('await window.MaofSheets.export('));
}
console.log('PASS: Google API flow with simulated authorization; 15-column mapping; literal-safe values; phone and numeric preservation; native dropdowns; verification before redirect; consent denial and partial-failure handling; both UI integrations.');
