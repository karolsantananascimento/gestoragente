// Helper de HTTP com erro legível. Falha explícita quando a plataforma não está configurada.
export async function httpJson(url, { method = 'GET', headers = {}, body, form } = {}) {
  const opts = { method, headers: { ...headers } };
  if (form) {
    opts.headers['content-type'] = 'application/x-www-form-urlencoded';
    opts.body = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    opts.headers['content-type'] = opts.headers['content-type'] || 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || data?.raw || res.statusText;
    const err = new Error(`HTTP ${res.status} em ${new URL(url).host}: ${String(msg).slice(0, 400)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export class NotConfigured extends Error {
  constructor(platform, missing) {
    super(`${platform} não configurado (faltam variáveis: ${missing.join(', ')}).`);
    this.name = 'NotConfigured';
  }
}
