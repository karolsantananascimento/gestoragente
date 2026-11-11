// Helper de HTTP com erro legível. Falha explícita quando a plataforma não está configurada.
export async function httpJson(url, { method = 'GET', headers = {}, body, form, formData } = {}) {
  const opts = { method, headers: { ...headers } };
  if (formData) {
    opts.body = formData; // multipart: o fetch define o content-type com o boundary
  } else if (form) {
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
    const er = data?.error || {};
    const det = [er.error_user_title, er.error_user_msg].filter(Boolean).join(': ');
    const msg = `${er.message || data?.message || data?.raw || res.statusText}${det ? ` — ${det}` : ''}${er.error_subcode ? ` (subcódigo ${er.error_subcode})` : ''}`;
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
