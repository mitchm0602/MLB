async function redisGet(key) {
  const url = process.env.mlb_KV_REST_API_URL;
  const token = process.env.mlb_KV_REST_API_TOKEN;
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function redisSet(key, value) {
  const url = process.env.mlb_KV_REST_API_URL;
  const token = process.env.mlb_KV_REST_API_TOKEN;
  await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([JSON.stringify(value)])
  });
}

const PICKS_KEY = 'mlb:picks';

async function loadPicks() {
  try {
    const data = await redisGet(PICKS_KEY);
    return data || [];
  } catch (e) {
    console.error('Redis load error:', e.message);
    return [];
  }
}

async function savePicks(picks) {
  await redisSet(PICKS_KEY, picks);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const picks = await loadPicks();
    const { date, status } = req.query;

    let filtered = picks;
    if (date) filtered = filtered.filter(p => p.gameDate === date);
    if (status) filtered = filtered.filter(p => p.result === status);

    const graded = picks.filter(p => p.result && !['pending','pass'].includes(p.result));
    const wins = graded.filter(p => p.result === 'win').length;
    const losses = graded.filter(p => p.result === 'loss').length;
    const pushes = graded.filter(p => p.result === 'push').length;

    const byDate = {};
    for (const pick of filtered) {
      if (!byDate[pick.gameDate]) byDate[pick.gameDate] = [];
      byDate[pick.gameDate].push(pick);
    }

    return res.status(200).json({
      picks: filtered,
      byDate,
      stats: {
        wins, losses, pushes,
        total: graded.length,
        pending: picks.filter(p => p.result === 'pending').length
      }
    });
  }

  if (req.method === 'POST') {
    const { picks: newPicks } = req.body;
    if (!Array.isArray(newPicks)) return res.status(400).json({ error: 'picks array required' });

    const existing = await loadPicks();

    for (const pick of newPicks) {
      const idx = existing.findIndex(p => p.gameId === pick.gameId && p.pickType === pick.pickType);
      if (idx >= 0) {
        if (existing[idx].result === 'pending') {
          existing[idx] = { ...existing[idx], ...pick };
        }
      } else {
        existing.push({ ...pick, result: pick.result || 'pending', savedAt: new Date().toISOString() });
      }
    }

    await savePicks(existing);
    return res.status(200).json({ saved: newPicks.length, total: existing.length });
  }

  if (req.method === 'DELETE') {
    await savePicks([]);
    return res.status(200).json({ cleared: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
