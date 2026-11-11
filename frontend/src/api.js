let token = null
let onUnauthorized = () => {}

export const setToken = (t) => { token = t }
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

export async function api(path, { method = 'GET', body, form, auth } = {}) {
  const headers = {}
  const t = auth || token
  if (t) headers.Authorization = `Bearer ${t}`
  let payload
  if (form) payload = form
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  const res = await fetch(`/api${path}`, { method, headers, body: payload })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && token && !auth) onUnauthorized()
    const d = data.detail
    const err = new Error(typeof d === 'string' ? d : d?.message || (Array.isArray(d) ? d.map((x) => x.msg).join('; ') : 'Request failed'))
    err.status = res.status
    err.checks = d?.checks
    throw err
  }
  return data
}
