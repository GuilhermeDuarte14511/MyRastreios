# MyRastreios

Script em Node.js que consulta o rastreamento da SSW (https://ssw.inf.br/2/rastreamento_pf) para um CPF de destinatário pessoa física. Ele envia os dados do formulário, interpreta o HTML retornado e mostra as ocorrências mais recentes, guardando o último resultado em `data/tracking-cache.json` para detectar mudanças.

## Pré-requisitos

- Node.js 20+ (usa `fetch` nativo, módulos ECMAScript e `Intl` recente).

## Instalação

```powershell
npm install
```

Crie um arquivo `.env` (não vai pro git) com as credenciais do SendGrid:

```
SENDGRID_API_KEY=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
SENDGRID_FROM=barbershopperbrasil@outlook.com
SENDGRID_TO=gui14511@gmail.com
```

Você pode listar vários destinatários em `SENDGRID_TO`, separados por vírgula. Caso o `.env` não exista, o script assume o e-mail acima e tenta enviar usando a API key presente nas variáveis de ambiente do shell.

## Uso rápido

```powershell
# executa uma consulta e mostra em texto
npm run track -- 42465174886

# mesmo comando em JSON (bom para automações)
npm run track -- 42465174886 --json

# se não quiser gravar nem ler o cache local
npm run track -- 42465174886 --no-cache
```

Saída típica:

```
CPF consultado: 424.651.748-86 (1 resultado(s))
Nenhuma alteração desde a última consulta.
- CHEGADA EM UNIDADE (MSI TS1 98) — 19/11/25 18:26 — EMBU DAS ARTES / SP
    NF/Coleta: 2 2067390 | Pedido: 802471973
    Chegada na unidade EMBU DAS ARTES em 19/11/25, 18:26h.
    Detalhes: https://ssw.inf.br/2/ssw_SSWDetalhado?id=...
```

- `--json` devolve um objeto contendo o CPF (mascarado e cru), todas as linhas encontradas e quais são as novidades.
- `--no-cache` evita criar `data/tracking-cache.json` e, consequentemente, não compara com execuções anteriores.

## Monitoramento + e-mail (10 em 10 minutos)

```powershell
# roda para sempre, consultando a cada 10 minutos e enviando e-mail quando houver status novo
npm run monitor -- 42465174886

# quer mudar o período? (ex: 5 minutos)
npm run monitor -- 42465174886 --interval 5
```

Regras do modo monitor:

- Usa sempre o cache local para descobrir o que é novo (não é compatível com `--no-cache`).
- Assim que encontrar novos status envia um e-mail com o resumo usando o SendGrid.
- Se `SENDGRID_API_KEY`, `SENDGRID_FROM` ou `SENDGRID_TO` estiverem vazios ele apenas registra um aviso e segue monitorando sem enviar e-mail (útil pra testar).

## Estrutura dos dados

Cada item retornado pelo site virá assim:

```json
{
  "invoiceOrPickup": "2 2067390",
  "orderOrRequest": "802471973",
  "unit": "EMBU DAS ARTES / SP",
  "timestamp": "19/11/25 18:26",
  "status": "CHEGADA EM UNIDADE (MSI TS1 98)",
  "description": "Chegada na unidade EMBU DAS ARTES em 19/11/25, 18:26h.",
  "detailsUrl": "https://ssw.inf.br/2/ssw_SSWDetalhado?id=..."
}
```

Com isso dá para enviar notificações, salvar histórico próprio ou integrar em qualquer dashboard.

## Observações

- `data/` e `.env*` estão no `.gitignore` porque o cache traz CPFs e tokens sensíveis.
- Se o HTML da SSW mudar, o parser dispara um erro dizendo que não encontrou a tabela. Ajuste os seletores nesse caso.
- Para rodar em background permanente, use `npm run monitor` numa sessão do PowerShell, `pm2`, agendador do Windows ou qualquer serviço que reinicie o processo em caso de queda.

## Deploy no Vercel com cron de 1 em 1 hora

O repositório traz um endpoint serverless em `api/cron` que roda a mesma rotina de busca e envio de e-mails usada pelo script local. O arquivo `vercel.json` já agenda esse endpoint para ser chamado a cada hora (`"schedule": "0 * * * *"`).

Variáveis de ambiente necessárias no Vercel:

- `SENDGRID_API_KEY`, `SENDGRID_FROM` e `SENDGRID_TO`: mesmas usadas no modo CLI.
- `TRACKING_CPFS`: lista de CPFs separados por vírgula que serão consultados em cada execução do cron.
- Opcional: `TRACKING_NO_CACHE=true` para ignorar o cache entre execuções (o padrão é manter o cache). Defina `CACHE_DIR=/tmp` caso queira garantir que o cache seja gravado num diretório com permissão de escrita em ambientes serverless.

Depois de configurar as variáveis, basta fazer o deploy. O Vercel chamará `https://<seu-projeto>.vercel.app/api/cron` a cada hora e enviará e-mails quando encontrar novos status.
