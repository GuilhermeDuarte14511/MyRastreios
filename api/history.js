import { logWithTimestamp, maskCpf, readCache } from '../src/rastreio.js';

export default async function handler(req, res) {
  try {
    logWithTimestamp('Consulta de histórico iniciada.');
    const cache = await readCache();
    const history = Object.entries(cache).map(([cpf, payload]) => ({
      cpf: maskCpf(cpf),
      updatedAt: payload.updatedAt,
      total: payload.entries?.length ?? 0,
      entries: payload.entries ?? [],
    }));

    res.status(200).json({ ok: true, history });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[history] ${message}`);
    res.status(500).json({ ok: false, error: message });
  }
}
