// Upstash Redis REST API
// SET: POST to /set/key with raw string body (Content-Type: text/plain)
// GET: GET to /get/key -> { result: "stored_string" }

const url = () => process.env.mlb_KV_REST_API_URL;
const token = () => process.env.mlb_KV_REST_API_TOKEN;
const auth = () => ({ Authorization: `Bearer ${token()}` });

export async function redisGet(key) {
  const res = await fetch(`${url()}/get/${encodeURIComponent(key)}`, {
    headers: auth()
  });
  const json = await res.json();
  if (json.result === null || json.result === undefined) return null;
  // result is a plain string — parse it once as JSON
  try { return JSON.parse(json.result); }
  catch { return json.result; }
}

export async function redisSet(key, value) {
  // Serialize value to a JSON string, send as plain text body
  const body = JSON.stringify(value);
  const res = await fetch(`${url()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { ...auth(), 'Content-Type': 'text/plain' },
    body: body  // raw JSON string, NOT wrapped in array
  });
  return res.json();
}

export async function redisDel(key) {
  await fetch(`${url()}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: auth()
  });
}
