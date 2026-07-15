/* ============================================================
   DigiWorld — HTTP API client.
   Thin wrapper around fetch with credentials:'include' (session cookie).
   Errors surface as { status, code, message, details? } thrown objects so
   callers can catch and branch on `.status` cheaply.
   ============================================================ */

const BASE = ''; // same-origin

async function request(method, path, body) {
  const opts = {
    method,
    credentials: 'include',
    headers: {},
  };
  if (body !== undefined && body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(BASE + path, opts);
  } catch (err) {
    throw { status: 0, code: 'network', message: err && err.message ? err.message : 'network error' };
  }
  const ct = res.headers.get('content-type') || '';
  const json = ct.includes('application/json') ? await res.json().catch(() => null) : null;
  if (!res.ok) {
    const payload = json || {};
    throw {
      status: res.status,
      code: payload.error || String(res.status),
      message: payload.error || res.statusText,
      details: payload.details,
    };
  }
  return json;
}

export const api = {
  get:    (path)       => request('GET', path),
  post:   (path, body) => request('POST', path, body),
  put:    (path, body) => request('PUT', path, body),
  del:    (path)       => request('DELETE', path),
};

/** Fire a transient toast at the bottom of the viewport. */
export function toast(msg, opts = {}) {
  let el = document.querySelector('.app-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'app-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('is-err', !!opts.error);
  el.classList.add('is-open');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('is-open'), opts.duration || 2600);
}

/** Very small render helper — sets textContent by id if present. */
export function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
