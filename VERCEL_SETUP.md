# MAOF — Google Maps Scraper na Vercel

## Arquitetura instalada

- Projeto Vercel: `maof-maps-scraper`.
- Front-end original em português, modos mapa e painel.
- API Node.js com `@vercel/sandbox` 3.9.1 e autenticação OIDC da Vercel.
- Motor `gosom/google-maps-scraper` 1.18.1, binário Linux amd64 com SHA256 verificado.
- Sandbox privado `maps-engine`; serviço somente em `127.0.0.1:8080`, sem portas públicas.
- Arquivos e resultados em `/vercel/mapsdata`. Bibliotecas Chromium instaladas apenas no sandbox.
- Proteção Vercel Authentication em todas as publicações.

O Docker Compose original continua disponível para instalação local, mas não é utilizado nesta implantação.

## Uso no navegador

Abra https://maof-maps-scraper.vercel.app e entre com sua conta Vercel.
Em “o que”, informe `barbearias`; em “onde”, `Goiânia, Goiás`.
O modo rápido é usado por padrão, pois o modo completo apresentou falhas na leitura do Google. Comece na profundidade 1, sem extração de e-mails. Clique em Pesquisar, espere terminar e exporte CSV.
O painel fica em `/painel`.

Limites da adaptação: 3 termos, profundidade máxima 5, 300 segundos por busca, download de até 3 MB.
O motor inicia novamente ao acessar a API quando uma sessão tiver parado.
As sessões duram 15 minutos. Uma busca em andamento pode ser interrompida quando a sessão termina.
Os arquivos sobrevivem à parada por snapshot; a retenção padrão é de 7 dias sem uso. Exporte seus resultados.
Sandbox, snapshots e funções consomem a franquia/créditos da conta Vercel; não se presume uso gratuito ilimitado.

## Uso pelo terminal

Com a CLI Vercel instalada e autenticada (`vercel login`), os pedidos passam pela mesma API protegida.

Listar buscas:

```bash
vercel curl https://maof-maps-scraper.vercel.app/api/v1/jobs
```

Criar busca pequena:

```bash
vercel curl https://maof-maps-scraper.vercel.app/api/v1/jobs -- \
  --request POST --header 'Content-Type: application/json' \
  --data '{"name":"Barbearias Goiânia","keywords":["barbearias em Goiânia"],"lang":"pt","lat":"-16.6869","lon":"-49.2648","zoom":14,"radius":5000,"depth":1,"email":false,"fast_mode":true,"max_time":300}'
```

A resposta contém o `id`. Consulte a lista até `Status` ser `ok`, então substitua `ID_DA_BUSCA`:

```bash
vercel curl https://maof-maps-scraper.vercel.app/api/v1/jobs/ID_DA_BUSCA/download -- --output empresas.csv
```

## Manutenção

Alterações no branch `master` geram novas publicações via integração GitHub/Vercel.
A construção usa `npm ci` e `npm run build`; não precisa de Docker no seu computador.
Não coloque credenciais ou resultados no GitHub.
Se o snapshot expirar, recrie o sandbox e instale o motor antes de retomar o uso.

## Exportação direta ao Google Sheets

O botão **Abrir no Google Sheets** dos modos Mapa e Painel cria uma planilha nativa no Drive e abre o editor. Os filtros visíveis são respeitados. O CSV continua disponível no botão Excel.

Antes do primeiro uso, configure um cliente OAuth do tipo Aplicativo da Web no Google Cloud, habilite a Sheets API e autorize a origem `https://maof-maps-scraper.vercel.app`. No painel, clique em **Configurar Google** e salve apenas o ID público do cliente. Nunca informe o client secret.

O guia detalhado está em `/app/google-sheets-setup.html`. A configuração inicial do projeto Google ainda requer a conta do proprietário; não é herdada da conexão do ChatGPT.

A exportação usa Google Identity Services e escopo `drive.file`. Tokens ficam apenas na memória da aba. Cada clique cria uma nova planilha, preservando os status das planilhas anteriores.

As colunas incluem Empresa, Categoria, Telefone, WhatsApp, E-mail, Site, Nota, Avaliações, Endereço, Google Maps, Status do contato, Data do contato, Responsável, Próximo retorno e Observações. Status disponíveis: Não contatado, Aguardando resposta, Respondeu, Não respondeu, Retornar depois, Sem interesse e Cliente fechado.

Validação local: `node scripts/test-google-sheets.mjs`. O teste simula autorização e API do Google; a criação real deve ser verificada após configurar o cliente OAuth.
