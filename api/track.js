import {
  logWithTimestamp,
  maskCpf,
  performTrackingCheck,
  sanitizeCpf,
  sendNotificationEmail,
} from '../src/rastreio.js';

async function parseJsonBody(req) {
  if (req.body) return req.body;

  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Corpo da requisição inválido. Envie um JSON.'));
      }
    });
    req.on('error', (error) => reject(error));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'Use POST para consultar um CPF.' });
    return;
  }

  try {
    const body = await parseJsonBody(req);
    const rawCpf = body?.cpf ?? req.query?.cpf;

    if (!rawCpf) {
      res.status(400).json({ ok: false, error: 'Informe o CPF no corpo da requisição.' });
      return;
    }

    const cpf = sanitizeCpf(rawCpf);
    logWithTimestamp(`Consulta manual recebida para ${maskCpf(cpf)}.`);

    const result = await performTrackingCheck(cpf, { noCache: false });
    const totalNewEntries = result.diff.newEntries.length;

    let emailSent = false;
    if (totalNewEntries > 0) {
      try {
        emailSent = await sendNotificationEmail({ cpf, newEntries: result.diff.newEntries });
      } catch (emailError) {
        console.error(`[track] Falha ao enviar e-mail: ${emailError.message}`);
      }
    }

    res.status(200).json({
      ok: true,
      cpf: maskCpf(cpf),
      total: result.entries.length,
      newEntries: totalNewEntries,
      hadPreviousRun: result.hadPreviousRun,
      cacheUsed: !result.cacheDisabled,
      emailSent,
      entries: result.entries,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error?.status && Number.isInteger(error.status) ? error.status : 500;
    console.error(`[track] ${message}`);
    res.status(status).json({ ok: false, error: message });
  }
}
