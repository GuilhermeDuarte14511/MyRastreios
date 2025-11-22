#!/usr/bin/env node
import 'dotenv/config';
import sgMail from '@sendgrid/mail';
import { load as loadHtml } from 'cheerio';
import fs from 'fs/promises';
import path from 'path';
import process from 'process';
import { fileURLToPath } from 'url';

const BASE_URL = 'https://ssw.inf.br';
const REFERER_URL = `${BASE_URL}/2/rastreamento_pf`;
const FORM_ENDPOINT = `${BASE_URL}/2/resultSSW_dest`;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = process.env.CACHE_DIR || path.resolve(__dirname, '..', 'data');
const CACHE_FILE = process.env.CACHE_FILE || path.resolve(CACHE_DIR, 'tracking-cache.json');
const DEFAULT_INTERVAL_MINUTES = 10;
const SENDGRID_DEFAULT_FROM = 'barbershopperbrasil@outlook.com';
const SENDGRID_DEFAULT_TO = 'gui14511@gmail.com';

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY ?? '';
const SENDGRID_FROM = process.env.SENDGRID_FROM || SENDGRID_DEFAULT_FROM;
const SENDGRID_TO = (process.env.SENDGRID_TO || SENDGRID_DEFAULT_TO)
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);

if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

async function main() {
  const parsedArgs = parseCliArgs(process.argv.slice(2));

  if (parsedArgs.showHelp) {
    printUsage();
    return;
  }

  const { cpf, flags } = parsedArgs;

  try {
    if (flags.watch) {
      validateWatchFlags(flags);
      await startWatchMode(cpf, flags);
      return;
    }

    const result = await performTrackingCheck(cpf, flags);

    if (flags.json) {
      printJson({
        cpf,
        maskedCpf: maskCpf(cpf),
        total: result.entries.length,
        newEntries: result.diff.newEntries,
        allEntries: result.entries,
        firstRun: !result.hadPreviousRun,
      });
      return;
    }

    printHumanReadable({ cpf, ...result });
  } catch (error) {
    handleError(error, flags.json);
  }
}

function parseCliArgs(argv) {
  const flags = {
    json: false,
    noCache: false,
    watch: false,
    intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--json':
        flags.json = true;
        break;
      case '--no-cache':
        flags.noCache = true;
        break;
      case '--watch':
        flags.watch = true;
        break;
      case '--help':
      case '-h':
        return { showHelp: true };
      default:
        if (arg.startsWith('--interval=')) {
          const [, rawValue] = arg.split('=');
          flags.intervalMinutes = parseInterval(rawValue);
        } else if (arg === '--interval') {
          const nextValue = argv[i + 1];
          if (!nextValue) {
            throw new Error('Informe o número de minutos após --interval.');
          }
          flags.intervalMinutes = parseInterval(nextValue);
          i += 1;
        } else if (arg.startsWith('-')) {
          throw new Error(`Flag desconhecida: ${arg}`);
        } else {
          positional.push(arg);
        }
        break;
    }
  }

  if (!positional.length) {
    return { showHelp: true };
  }

  return {
    cpf: sanitizeCpf(positional[0]),
    flags,
  };
}

function validateWatchFlags(flags) {
  if (flags.json) {
    throw new Error('Não é possível usar --json em modo --watch.');
  }
  if (flags.noCache) {
    throw new Error('O modo --watch precisa do cache para detectar novos status. Remova --no-cache.');
  }
}

function parseInterval(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Intervalo inválido. Informe um número em minutos maior que zero.');
  }
  return parsed;
}

function sanitizeCpf(value) {
  const digits = (value ?? '').replace(/\D/g, '');
  if (digits.length !== 11) {
    throw new Error('CPF deve conter 11 dígitos.');
  }
  return digits;
}

function maskCpf(value) {
  return value.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

async function performTrackingCheck(cpf, flags) {
  const html = await fetchTrackingPage(cpf);
  const entries = parseTrackingPage(html);

  let previousEntries = [];
  let cache = {};

  if (!flags.noCache) {
    cache = await readCache();
    previousEntries = cache[cpf]?.entries ?? [];
  }

  const diff = diffEntries(previousEntries, entries);

  if (!flags.noCache) {
    cache[cpf] = {
      updatedAt: new Date().toISOString(),
      entries,
    };
    await writeCache(cache);
  }

  return {
    entries,
    diff,
    hadPreviousRun: previousEntries.length > 0,
    cacheDisabled: flags.noCache,
  };
}

async function startWatchMode(cpf, flags) {
  console.log(`Monitorando ${maskCpf(cpf)} a cada ${flags.intervalMinutes} minuto(s).`);

  if (!SENDGRID_API_KEY) {
    console.warn('A variável SENDGRID_API_KEY não está configurada. Os e-mails não serão enviados.');
  }

  if (!SENDGRID_TO.length) {
    console.warn('Nenhum destinatário configurado em SENDGRID_TO. Configure para receber os alertas.');
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const startedAt = Date.now();

    try {
      const result = await performTrackingCheck(cpf, { ...flags, watch: false });
      if (result.diff.newEntries.length) {
        logWithTimestamp(`${result.diff.newEntries.length} novo(s) status encontrado(s). Preparando e-mail...`);
        try {
          await sendNotificationEmail({
            cpf,
            newEntries: result.diff.newEntries,
          });
          logWithTimestamp('E-mail enviado com sucesso.');
        } catch (emailError) {
          console.error(`Falha ao enviar e-mail: ${emailError.message}`);
        }
      } else {
        logWithTimestamp('Nenhuma novidade.');
      }
    } catch (error) {
      console.error(`[${new Date().toLocaleString()}] Erro durante consulta: ${error.message}`);
    }

    const elapsed = Date.now() - startedAt;
    const sleepMs = Math.max(flags.intervalMinutes * 60_000 - elapsed, 1_000);
    await delay(sleepMs);
  }
}

async function fetchTrackingPage(cpf) {
  const params = new URLSearchParams();
  params.set('cnpjdest', cpf);
  params.set('urlori', '/2/rastreamento_pf');

  const response = await fetch(FORM_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: BASE_URL,
      Referer: REFERER_URL,
      'User-Agent': 'MyRastreiosBot/1.1 (+https://github.com/GuilhermeDuarte14511/MyRastreios)',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    throw new Error(`Erro ao consultar o site da SSW (${response.status} ${response.statusText}).`);
  }

  return response.text();
}

function parseTrackingPage(html) {
  const $ = loadHtml(html);
  const tables = $('table');
  let resultTable;

  tables.each((_, el) => {
    const headerCells = $(el).find('td.tdresult');
    if (headerCells.length >= 3) {
      const headerText = headerCells.eq(2).text();
      if (headerText && headerText.toLowerCase().includes('situação')) {
        resultTable = $(el);
        return false;
      }
    }
    return true;
  });

  if (!resultTable || resultTable.length === 0) {
    throw new Error('Não consegui encontrar a tabela de resultados. O layout pode ter mudado.');
  }

  const rows = [];
  const tableRows = resultTable.find('tr');

  tableRows.each((_, tr) => {
    const cells = $(tr).find('td');

    if (cells.length === 3) {
      if ($(cells[0]).hasClass('tdresult')) {
        return;
      }

      const docLines = extractCellLines(cells.eq(0));
      if (!docLines.length) {
        return;
      }

      const unitLines = extractCellLines(cells.eq(1));
      const statusTitle = normalizeText($(cells[2]).find('p.titulo').first().text());
      const description = extractDescription($, $(cells[2]));
      const detailsUrl = extractDetailsUrl($(cells[2]));

      rows.push({
        invoiceOrPickup: docLines[0] ?? '',
        orderOrRequest: docLines[1] ?? '',
        unit: unitLines[0] ?? '',
        timestamp: unitLines.slice(1).join(' ') ?? '',
        status: statusTitle,
        description,
        detailsUrl,
      });
      return;
    }

    const textContent = normalizeText($(tr).text());
    if (textContent && textContent.toLowerCase().includes('nenhuma informação')) {
      throw new Error('Nenhuma informação encontrada para o CPF informado.');
    }
  });

  if (!rows.length) {
    throw new Error('Não foi possível extrair nenhum resultado do HTML retornado.');
  }

  return rows;
}

function extractCellLines(cell) {
  const rawHtml = cell.html() ?? '';
  return rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?p[^>]*>/gi, '\n')
    .split('\n')
    .map((segment) => normalizeText(segment.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

function extractDescription($, cell) {
  const paragraphs = cell.find('p.tdb');
  if (!paragraphs.length) {
    return '';
  }

  return normalizeText(
    paragraphs
      .map((_, el) => normalizeText($(el).text()))
      .get()
      .find((text) => text.length > 0) ?? '',
  );
}

function extractDetailsUrl(cell) {
  const link = cell.find('a.email').first();
  if (!link.length) {
    return null;
  }

  const onclick = link.attr('onclick') ?? '';
  const match = onclick.match(/opx\('([^']+)'/i);
  if (!match) {
    return null;
  }

  const urlPath = match[1];
  return new URL(urlPath, BASE_URL).toString();
}

function normalizeText(text) {
  return (text ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function diffEntries(previous, current) {
  const prevIds = new Set((previous ?? []).map(buildEntryId));
  const currentIds = current.map(buildEntryId);
  const newEntries = current.filter((entry, idx) => !prevIds.has(currentIds[idx]));

  return {
    newEntries,
    entryIdLookup: new Set(newEntries.map(buildEntryId)),
  };
}

function buildEntryId(entry) {
  return [
    entry.invoiceOrPickup ?? '',
    entry.orderOrRequest ?? '',
    entry.unit ?? '',
    entry.timestamp ?? '',
    entry.status ?? '',
  ]
    .map((segment) => segment || '')
    .join('|');
}

function printHumanReadable({ cpf, entries, diff, hadPreviousRun, cacheDisabled }) {
  console.log(`CPF consultado: ${maskCpf(cpf)} (${entries.length} resultado(s))`);
  if (cacheDisabled) {
    console.log('Cache local desabilitado (--no-cache). Comparação com consultas anteriores não será feita.');
  }

  if (!entries.length) {
    console.log('Nenhum rastreio retornado pelo site.');
    return;
  }

  if (!hadPreviousRun || cacheDisabled) {
    console.log('Listando resultados retornados pela SSW:');
  } else if (diff.newEntries.length) {
    console.log(`${diff.newEntries.length} novo(s) status desde a última consulta:`);
  } else {
    console.log('Nenhuma alteração desde a última consulta.');
  }

  const highlightIds = cacheDisabled ? new Set() : diff.entryIdLookup;

  entries.forEach((entry, index) => {
    const marker = highlightIds.has(buildEntryId(entry)) ? '*' : '-';
    console.log(
      `${marker} ${entry.status || 'Situação não informada'} — ${entry.timestamp || 'Sem data'} — ${entry.unit || 'Unidade desconhecida'}`,
    );
    console.log(`    NF/Coleta: ${entry.invoiceOrPickup || '-'} | Pedido: ${entry.orderOrRequest || '-'}`);
    if (entry.description) {
      console.log(`    ${entry.description}`);
    }
    if (entry.detailsUrl) {
      console.log(`    Detalhes: ${entry.detailsUrl}`);
    }
    if (index < entries.length - 1) {
      console.log('');
    }
  });

  if (!cacheDisabled && diff.newEntries.length) {
    console.log('\n(*) indica status que não estavam presentes na consulta anterior.');
  }
}

async function sendNotificationEmail({ cpf, newEntries }) {
  if (!SENDGRID_API_KEY || !SENDGRID_TO.length) {
    console.warn('Configuração do SendGrid ausente. Pular envio de e-mail.');
    return false;
  }

  const subject = `SSW: ${newEntries.length} novo(s) status para ${maskCpf(cpf)}`;
  const textLines = [
    `Encontramos ${newEntries.length} novo(s) status para ${maskCpf(cpf)}.`,
    '',
    ...newEntries.map((entry, index) => formatEntryForText(entry, index + 1)),
  ];
  const htmlItems = newEntries
    .map(
      (entry) => `
        <li>
          <strong>${entry.status || 'Situação não informada'}</strong><br/>
          <em>${entry.timestamp || 'Sem data'} — ${entry.unit || 'Unidade desconhecida'}</em><br/>
          NF/Coleta: ${entry.invoiceOrPickup || '-'} | Pedido: ${entry.orderOrRequest || '-'}<br/>
          ${entry.description || ''}
        </li>
      `,
    )
    .join('');

  await sgMail.send({
    to: SENDGRID_TO,
    from: SENDGRID_FROM,
    subject,
    text: textLines.join('\n'),
    html: `<p>${textLines[0]}</p><ul>${htmlItems}</ul>`,
  });

  return true;
}

function formatEntryForText(entry, index) {
  return `${index}. ${entry.status || 'Situação não informada'} — ${entry.timestamp || 'Sem data'} — ${
    entry.unit || 'Unidade desconhecida'
  }\n   NF/Coleta: ${entry.invoiceOrPickup || '-'} | Pedido: ${entry.orderOrRequest || '-'}\n   ${entry.description || ''}`;
}

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

async function readCache() {
  try {
    const content = await fs.readFile(CACHE_FILE, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

async function writeCache(cache) {
  const dir = path.dirname(CACHE_FILE);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logWithTimestamp(message) {
  console.log(`[${new Date().toLocaleString()}] ${message}`);
}

function printUsage() {
  console.log('Uso: node src/rastreio.js <CPF> [--json] [--no-cache] [--watch] [--interval <minutos>]');
  console.log('');
  console.log('Exemplos:');
  console.log('  node src/rastreio.js 42465174886');
  console.log('  node src/rastreio.js 42465174886 --json');
  console.log('  node src/rastreio.js 42465174886 --watch --interval 10');
  console.log('');
  console.log('Flags:');
  console.log('  --json          Retorna os dados em JSON para integrações.');
  console.log('  --no-cache      Não persiste nem consulta o cache local com o último resultado.');
  console.log('  --watch         Mantém o script rodando e envia e-mails quando surgirem novos status.');
  console.log('  --interval N    Intervalo em minutos entre as consultas no modo watch (padrão: 10).');
}

function handleError(error, asJson) {
  const message = error instanceof Error ? error.message : String(error);
  if (asJson) {
    printJson({ ok: false, error: message });
  } else {
    console.error(`Erro: ${message}`);
  }
  process.exit(1);
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}

export {
  CACHE_FILE,
  performTrackingCheck,
  sendNotificationEmail,
  sanitizeCpf,
  maskCpf,
  logWithTimestamp,
};
