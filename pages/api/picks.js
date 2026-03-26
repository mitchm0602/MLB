import { redisGet, redisSet } from './_redis';

const KEY = 'mlb:picks:v3'; // v2 = clean key, abandons corrupted v1 data

async function loadPicks() {
  try {
    const data = await redisGet(KEY);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('loadPicks error:', e.message);
    return [];
  }
}

async function savePicks(picks) {
  await redisSet(KEY, picks);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const picks = await loadPicks();
    const { date } = req.query;

    let filtered = picks;
    if (date) filtered = filtered.filter(p => p.gameDate === date);

    const graded = picks.filter(p => p.result && !['pending', 'pass'].includes(p.result));
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
      const idx = existing.findIndex(p =>
        String(p.gameId) === String(pick.gameId) && p.pickType === pick.pickType
      );
      if (idx >= 0) {
        // Only update if still pending
        if (existing[idx].result === 'pending') {
          existing[idx] = { ...existing[idx], ...pick };
        }
      } else {
        existing.push({ ...pick, result: 'pending', savedAt: new Date().toISOString() });
      }
    }

    await savePicks(existing);
    return res.status(200).json({ saved: newPicks.length, total: existing.length });
  }

  if (req.method === 'DELETE') {
    await redisSet(KEY, []);
    return res.status(200).json({ cleared: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
