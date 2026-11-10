/* Google Sheets export. The OAuth client ID is public; access tokens stay in memory. */
(function (root) {
  'use strict';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const STATUS = ['Não contatado', 'Aguardando resposta', 'Respondeu', 'Não respondeu', 'Retornar depois', 'Sem interesse', 'Cliente fechado'];
  const HEADERS = ['Empresa', 'Categoria', 'Telefone', 'WhatsApp', 'E-mail', 'Site', 'Nota', 'Avaliações', 'Endereço', 'Google Maps', 'Status do contato', 'Data do contato', 'Responsável', 'Próximo retorno', 'Observações'];
  const ID_KEY = 'maof-google-client-id';
  const rgb = hex => ({red:parseInt(hex.slice(1,3),16)/255,green:parseInt(hex.slice(3,5),16)/255,blue:parseInt(hex.slice(5,7),16)/255});
  const cell = value => ({userEnteredValue:{stringValue:String(value ?? '')}});
  const range = (startRowIndex,endRowIndex,startColumnIndex=0,endColumnIndex=15) => ({sheetId:0,startRowIndex,endRowIndex,startColumnIndex,endColumnIndex});

  function buildSpreadsheet(title, rows) {
    if (!Array.isArray(rows) || !rows.length) throw new Error('Nenhuma empresa para exportar.');
    if (rows.length > 10000) throw new Error('Exporte até 10.000 empresas por planilha.');
    const n = Math.max(rows.length + 101, 1000);
    const data = rows.map(row => {
      const values = [...row.slice(0,10)];
      while(values.length < 10) values.push('');
      values.push('Não contatado','','','','');
      return {values:values.map((v,i) => {
        if ((i===6 || i===7) && v!=='' && v!=null && Number.isFinite(Number(String(v).replace(',','.')))) {
          return {userEnteredValue:{numberValue:Number(String(v).replace(',','.'))}};
        }
        // Explicit stringValue prevents formula execution and preserves phone numbers.
        return cell(v);
      })};
    });
    const palette = ['#64748b','#ca8a04','#15803d','#dc2626','#2563eb','#6b7280','#7c3aed'];
    return {
      properties:{title:('MAOF · '+title).slice(0,180),locale:'pt_BR',timeZone:'America/Sao_Paulo'},
      sheets:[{
        properties:{sheetId:0,title:'Empresas',gridProperties:{rowCount:n,columnCount:15,frozenRowCount:1,frozenColumnCount:1,hideGridlines:true}},
        data:[{startRow:0,startColumn:0,rowData:[{values:HEADERS.map(cell)},...data]}],
        basicFilter:{range:range(0,rows.length+1)},
        bandedRanges:[{range:range(0,rows.length+1),rowProperties:{headerColor:rgb('#261308'),firstBandColor:rgb('#ffffff'),secondBandColor:rgb('#f7f4ef')}}],
        conditionalFormats:STATUS.map((status,i)=>({ranges:[range(1,n,10,11)],booleanRule:{condition:{type:'TEXT_EQ',values:[{userEnteredValue:status}]},format:{backgroundColor:rgb(i===2?'#dcfce7':i===3?'#fee2e2':i===6?'#ede9fe':'#f1f5f9'),textFormat:{foregroundColor:rgb(palette[i]),bold:true}}}}))
      }]
    };
  }

  function formatRequests(rowCount) {
    const n=Math.max(rowCount+101,1000);
    const widths=[240,170,150,220,230,240,80,100,340,240,190,150,150,150,340];
    return [
      {repeatCell:{range:range(0,n),cell:{userEnteredFormat:{textFormat:{fontFamily:'Arial',fontSize:10},verticalAlignment:'TOP',wrapStrategy:'CLIP'}},fields:'userEnteredFormat'}},
      {repeatCell:{range:range(0,1),cell:{userEnteredFormat:{backgroundColor:rgb('#261308'),textFormat:{fontFamily:'Arial',fontSize:11,bold:true,foregroundColor:rgb('#ffffff')},verticalAlignment:'MIDDLE',wrapStrategy:'WRAP'}},fields:'userEnteredFormat'}},
      {updateDimensionProperties:{range:{sheetId:0,dimension:'ROWS',startIndex:0,endIndex:1},properties:{pixelSize:44},fields:'pixelSize'}},
      ...widths.map((pixelSize,i)=>({updateDimensionProperties:{range:{sheetId:0,dimension:'COLUMNS',startIndex:i,endIndex:i+1},properties:{pixelSize},fields:'pixelSize'}})),
      {setDataValidation:{range:range(1,n,10,11),rule:{condition:{type:'ONE_OF_LIST',values:STATUS.map(userEnteredValue=>({userEnteredValue}))},strict:true,showCustomUi:true,inputMessage:'Escolha a situação deste contato.'}}},
      ...[11,13].map(i=>({repeatCell:{range:range(1,n,i,i+1),cell:{userEnteredFormat:{numberFormat:{type:'DATE',pattern:'dd/mm/yyyy'}}},fields:'userEnteredFormat.numberFormat'}})),
      {repeatCell:{range:range(1,n,6,7),cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0.0'}}},fields:'userEnteredFormat.numberFormat'}},
      {repeatCell:{range:range(1,n,7,8),cell:{userEnteredFormat:{numberFormat:{type:'NUMBER',pattern:'0'}}},fields:'userEnteredFormat.numberFormat'}},
      {updateCells:{start:{sheetId:0,rowIndex:0,columnIndex:10},rows:[{values:[{note:'Use a lista para acompanhar o retorno. As próximas exportações criam novas planilhas e não alteram seus contatos anteriores.'}]}],fields:'note'}}
    ];
  }

  let token=null,tokenExpires=0,active=false;
  function clientId() { try {return localStorage.getItem(ID_KEY)||'';} catch {return '';} }
  function authorize(id) {
    if(token && Date.now()<tokenExpires) return Promise.resolve(token);
    if(!root.google?.accounts?.oauth2) return Promise.reject(new Error('A conexão com o Google ainda está carregando. Tente novamente; se persistir, confira seu bloqueador de scripts.'));
    return new Promise((resolve,reject)=>{
      const client=root.google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,include_granted_scopes:false,
        callback:response=>{
          if(response.error) return reject(new Error('A autorização do Google não foi concluída.'));
          if(!root.google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)) return reject(new Error('Autorize a criação dos arquivos para exportar a planilha.'));
          token=response.access_token;tokenExpires=Date.now()+(Number(response.expires_in)-60)*1000;resolve(token);
        },error_callback:()=>reject(new Error('A janela de autorização foi fechada ou bloqueada. Tente novamente.'))});
      client.requestAccessToken({prompt:''});
    });
  }
  async function googleRequest(path,body,accessToken) {
    const response=await fetch('https://sheets.googleapis.com/v4/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json();
    if(!response.ok) {
      if(response.status===401) {token=null;tokenExpires=0;}
      throw new Error(result.error?.message || 'O Google não conseguiu criar a planilha.');
    }
    return result;
  }
  function progress(text,url) {
    let box=document.getElementById('maof-sheets-progress');
    if(!box) {
      box=document.createElement('div');box.id='maof-sheets-progress';box.setAttribute('role','status');box.setAttribute('aria-live','polite');
      Object.assign(box.style,{position:'fixed',right:'20px',bottom:'55px',maxWidth:'420px',padding:'18px',borderRadius:'16px',background:'#fff',color:'#261308',boxShadow:'0 8px 45px #0003',font:'14px/1.5 Arial',zIndex:'10010'});
      document.body.appendChild(box);
    }
    box.replaceChildren(document.createTextNode(text));
    if(url) {const a=document.createElement('a');a.href=url;a.textContent=' Abrir planilha';a.target='_blank';a.rel='noopener';box.appendChild(a);}
    const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Fechar aviso');Object.assign(close.style,{marginLeft:'15px',cursor:'pointer'});close.onclick=()=>box.remove();box.appendChild(close);
  }
  function configure() {
    let dialog=document.getElementById('maof-sheets-config');
    if(!dialog) {
      dialog=document.createElement('dialog');dialog.id='maof-sheets-config';
      Object.assign(dialog.style,{border:'1px solid #e6dfd7',borderRadius:'18px',padding:'26px',width:'min(520px,90vw)',color:'#261308',font:'14px/1.6 Arial'});
      dialog.innerHTML='<form method="dialog"><button style="float:right" aria-label="Fechar">×</button></form><h2 style="margin:0 0 12px">Conectar Google Sheets</h2><p>Uma configuração inicial permite criar as planilhas diretamente no seu Google Drive. O identificador abaixo é público; não cole senhas, chaves ou client secrets.</p><ol><li>No Google Cloud, ative a <b>Google Sheets API</b>.</li><li>Configure o Google Auth Platform: nome do aplicativo, seu e-mail e seu usuário de teste, caso esteja em modo de teste.</li><li>Crie um <b>cliente OAuth para Aplicativo da Web</b>. Nas origens JavaScript autorizadas, adicione a origem exibida abaixo.</li><li>Cole o <b>ID do cliente</b> e salve. Depois clique novamente em “Abrir no Google Sheets” e autorize sua conta.</li></ol><p><a href="https://console.cloud.google.com/apis/library/sheets.googleapis.com" target="_blank" rel="noopener">Ativar Sheets API</a> · <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noopener">Criar cliente OAuth</a> · <a href="/app/google-sheets-setup.html" target="_blank" rel="noopener">Ver passo a passo</a></p><label>Origem autorizada<input id="maof-sheets-origin" readonly style="display:block;width:100%;box-sizing:border-box;margin:6px 0 14px;padding:10px"></label><form id="maof-sheets-save"><label>ID do cliente OAuth<input id="maof-sheets-client" required placeholder="…apps.googleusercontent.com" style="display:block;width:100%;box-sizing:border-box;margin:6px 0 14px;padding:10px"></label><p id="maof-sheets-config-error" role="alert"></p><button type="submit" style="padding:10px 18px;cursor:pointer">Salvar configuração</button></form><p>O site pede acesso somente aos arquivos criados ou selecionados para este aplicativo. Os tokens de acesso ficam apenas na memória desta aba.</p>';
      document.body.appendChild(dialog);
      dialog.querySelector('#maof-sheets-origin').value=location.origin;
      dialog.querySelector('#maof-sheets-save').addEventListener('submit',e=>{
        e.preventDefault();const id=dialog.querySelector('#maof-sheets-client').value.trim();
        if(!/^[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(id)) {dialog.querySelector('#maof-sheets-config-error').textContent='Informe o ID do cliente OAuth, terminado em .apps.googleusercontent.com.';return;}
        try {localStorage.setItem(ID_KEY,id);token=null;tokenExpires=0;dialog.close();progress('Configuração salva. Clique em Abrir no Google Sheets para autorizar e exportar.');}
        catch {dialog.querySelector('#maof-sheets-config-error').textContent='Seu navegador bloqueou o armazenamento da configuração.';}
      });
    }
    dialog.querySelector('#maof-sheets-client').value=clientId();dialog.showModal();
  }

  async function exportSheet(title,rows) {
    if(active) return;
    const id=clientId();
    if(!id) {configure();return;}
    if(!rows.length) {progress('Nenhuma empresa visível para exportar.');return;}
    active=true;let created;
    try {
      // Called from the export click, before awaiting any network work (popup permission).
      const authorization=authorize(id);
      progress('Autorize sua conta Google para criar a planilha.');
      const accessToken=await authorization;
      progress('Criando a planilha no seu Google Drive…');
      created=await googleRequest('spreadsheets',buildSpreadsheet(title,rows),accessToken);
      const requests=formatRequests(rows.length);
      await googleRequest('spreadsheets/'+created.spreadsheetId+':batchUpdate',{requests},accessToken);
      // Verify native validation, filter, frozen header and written rows before opening.
      const verified=await googleRequest('spreadsheets/'+created.spreadsheetId+'?ranges=Empresas!A1:O2&includeGridData=true',null,accessToken);
      const sheet=verified.sheets?.[0];
      if(sheet?.properties?.gridProperties?.frozenRowCount!==1 || !sheet.basicFilter || sheet.data?.[0]?.rowData?.[1]?.values?.[10]?.dataValidation?.condition?.type!=='ONE_OF_LIST') throw new Error('A planilha foi criada, mas a validação da formatação ficou incompleta.');
      const url='https://docs.google.com/spreadsheets/d/'+created.spreadsheetId+'/edit';
      progress('Planilha pronta: '+rows.length+' empresas com acompanhamento de contatos.',url);
      location.assign(url);
    } catch(error) {
      progress(error.message,created?'https://docs.google.com/spreadsheets/d/'+created.spreadsheetId+'/edit':null);
    } finally {active=false;}
  }
  const api={export:exportSheet,configure,buildSpreadsheet,formatRequests,HEADERS,STATUS};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  root.MaofSheets=api;
  if(typeof document!=='undefined') {
    document.querySelectorAll('button[data-export="sheets"]').forEach(exportButton=>{
      const button=document.createElement('button');button.type='button';button.textContent='Configurar Google';
      button.className=exportButton.className;
      button.addEventListener('click',configure);exportButton.after(button);
    });
  }
})(typeof window!=='undefined'?window:globalThis);
