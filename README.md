# MyRastreios

Script em Node.js que consulta o rastreamento da SSW (https://ssw.inf.br/2/rastreamento_pf) para um CPF de destinatário pessoa física. Ele envia os dados do formulário, interpreta o HTML retornado e mostra as ocorrências mais recentes, guardando o último resultado em `data/tracking-cache.json` para detectar mudanças.

## Pré-requisitos

- Node.js 20+ (usa `fetch` nativo, módulos ECMAScript e `Intl` recente).

## Instalação

```powershell
npm install
```

As credenciais do SendGrid já estão embutidas no código para facilitar o deploy no Vercel como worker. Caso queira mudar, basta
criar um `.env` com as chaves abaixo (ou editar diretamente em `src/rastreio.js`):

```
SENDGRID_API_KEY=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
SENDGRID_FROM=barbershopperbrasil@outlook.com
SENDGRID_TO=gui14511@gmail.com
TRACKING_CPFS=42465174886
```

Você pode listar vários destinatários em `SENDGRID_TO`, separados por vírgula. O código também tem valores padrão para
funcionar mesmo sem variáveis de ambiente.

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

## Monitoramento + e-mail (a cada 1 hora)

```powershell
# roda para sempre, consultando a cada 1 hora e enviando e-mail quando houver status novo
npm run monitor -- 42465174886

# quer mudar o período? (ex: 30 minutos)
npm run monitor -- 42465174886 --interval 30
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

## Deploy no Vercel (apenas endpoints manuais)

O projeto continua preparado para rodar como funções serverless do Vercel, mas o cron agendado foi removido para evitar execuções automáticas. Você pode disparar consultas manuais via `api/track` e acompanhar o histórico em `api/history`, ambos já usando as credenciais e parâmetros padrão descritos acima.

### Dashboard web embutido

- Abra `/` para ver um painel moderno, responsivo e alimentado pelo cache do worker. Ele se atualiza automaticamente a cada 30 segundos, destaca novidades e exibe os CPFs monitorados, total de ocorrências e última atualização.
