import {
  logWithTimestamp,
  maskCpf,
  performTrackingCheck,
  sanitizeCpf,
  sendNotificationEmail,
} from '../src/rastreio.js';

function parseCpfList() {
  const raw = process.env.TRACKING_CPFS || process.env.TRACKING_CPF || '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map(sanitizeCpf);
}

export default async function handler(req, res) {
  try {
    const cpfs = parseCpfList();

    if (!cpfs.length) {
      res.status(400).json({ ok: false, error: 'Defina TRACKING_CPFS com um ou mais CPFs separados por vírgula.' });
      return;
    }

    const useCache = process.env.TRACKING_NO_CACHE !== 'true';
    const results = [];

    for (const cpf of cpfs) {
      logWithTimestamp(`Iniciando verificação agendada para ${maskCpf(cpf)}.`);
      const result = await performTrackingCheck(cpf, { noCache: !useCache });
      let emailSent = false;

      if (result.diff.newEntries.length) {
        emailSent = await sendNotificationEmail({ cpf, newEntries: result.diff.newEntries });
        logWithTimestamp(`Notificação enviada para ${maskCpf(cpf)} com ${result.diff.newEntries.length} novo(s) status.`);
      } else {
        logWithTimestamp(`Nenhum novo status encontrado para ${maskCpf(cpf)}.`);
      }

      results.push({
        cpf: maskCpf(cpf),
        total: result.entries.length,
        newEntries: result.diff.newEntries.length,
        emailSent,
        cacheUsed: useCache && !result.cacheDisabled,
      });
    }

    res.status(200).json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    res.status(500).json({ ok: false, error: message });
  }
}
