// Shared Redis helpers using Upstash REST API directly
// Handles serialization correctly - stores as plain JSON string, reads back as parsed object

const getUrl = () => process.env.mlb_KV_REST_API_URL;
const getToken = () => process.env.mlb_KV_REST_API_TOKEN;

export async function redisGet(key) {
  const res = await fetch(`${getUrl()}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${getToken()}` }
  });
  const data = await res.json();
  if (!data.result) return null;
  // Upstash returns the value as a string - parse it once
  try {
    return JSON.parse(data.result);
  } catch {
    return data.result;
  }
}

export async function redisSet(key, value) {
  // Serialize once to a plain JSON string
  const serialized = JSON.stringify(value);
  const res = await fetch(`${getUrl()}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json'
    },
    // Upstash REST API: body is [value] array for SET command
    body: JSON.stringify([serialized])
  });
  return res.json();
}

export async function redisDel(key) {
  await fetch(`${getUrl()}/del/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` }
  });
}
