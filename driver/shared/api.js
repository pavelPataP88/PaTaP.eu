let csrfToken = null;

export async function api(path, options = {}) {
  const method = options.method || "GET";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const controller = options.signal ? null : new AbortController();
  const timeout = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (!["GET", "HEAD"].includes(method) && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  let response;
  try {
    const { timeoutMs: _timeoutMs, ...fetchOptions } = options;
    response = await fetch(path, {
      ...fetchOptions,
      method,
      headers,
      signal: options.signal || controller.signal,
      credentials: "same-origin",
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("request_timeout");
      timeoutError.status = 0;
      throw timeoutError;
    }
    throw error;
  } finally {
    if (timeout !== null) window.clearTimeout(timeout);
  }
  const data = await response.json().catch(() => ({}));
  if (data.csrfToken) csrfToken = data.csrfToken;
  if (!response.ok) {
    const error = new Error(data.error || "request_failed");
    error.status = response.status;
    Object.assign(error, data);
    throw error;
  }
  return data;
}

export async function ensureCsrf() {
  if (!csrfToken) await api("/api/csrf");
}

export async function uploadBinary(path, blob, { headers = {}, timeoutMs = 75_000 } = {}) {
  await ensureCsrf();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(path, {
      method: "POST", credentials: "same-origin", signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": blob.type || "application/octet-stream", "X-CSRF-Token": csrfToken, ...headers },
      body: blob
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("request_timeout"); timeoutError.status = 0; throw timeoutError;
    }
    throw error;
  } finally { window.clearTimeout(timeout); }
  const data = await response.json().catch(() => ({}));
  if (data.csrfToken) csrfToken = data.csrfToken;
  if (!response.ok) { const error = new Error(data.error || "request_failed"); error.status = response.status; throw error; }
  return data;
}

export function resetCsrf() {
  csrfToken = null;
}
