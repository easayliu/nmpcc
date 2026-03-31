let apiKey = localStorage.getItem('nmpcc_api_key') || '';

export function setApiKey(key) {
  apiKey = key;
  localStorage.setItem('nmpcc_api_key', key);
}

export function getApiKey() { return apiKey; }

export async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (apiKey) opts.headers['Authorization'] = 'Bearer ' + apiKey;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(err?.error?.message || res.statusText);
  }
  return res.json();
}
