import fs from 'fs';
import path from 'path';

// On Vercel, /tmp is the only writable directory
const DATA_FILE = path.join('/tmp', 'mlb-picks.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Load error:', e.message);
  }
  return { picks: [] };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    const data = loadData();
    const { date, status } = req.query;

    let picks = data.picks || [];
    if (date) picks = picks.filter(p => p.gameDate === date);
    if (status) picks = picks.filter(p => p.result === status);

    // Compute summary stats
    const graded = picks.filter(p => p.result && p.result !== 'pending');
    const wins = graded.filter(p => p.result === 'win').length;
    const losses = graded.filter(p => p.result === 'loss').length;
    const pushes = graded.filter(p => p.result === 'push').length;

    // Group by date
    const byDate = {};
    for (const pick of picks) {
      if (!byDate[pick.gameDate]) byDate[pick.gameDate] = [];
      byDate[pick.gameDate].push(pick);
    }

    return res.status(200).json({
      picks,
      byDate,
      stats: { wins, losses, pushes, total: graded.length, pending: picks.filter(p => !p.result || p.result === 'pending').length }
    });
  }

  if (req.method === 'POST') {
    // Save a new pick or batch of picks
    const { picks: newPicks } = req.body;
    if (!Array.isArray(newPicks)) return res.status(400).json({ error: 'picks array required' });

    const data = loadData();

    for (const pick of newPicks) {
      // Deduplicate by gameId + pickType
      const existing = data.picks.findIndex(p => p.gameId === pick.gameId && p.pickType === pick.pickType);
      if (existing >= 0) {
        // Update existing (preserve result if already graded)
        data.picks[existing] = { ...data.picks[existing], ...pick };
      } else {
        data.picks.push({
          ...pick,
          result: pick.result || 'pending',
          savedAt: new Date().toISOString()
        });
      }
    }

    saveData(data);
    return res.status(200).json({ saved: newPicks.length, total: data.picks.length });
  }

  if (req.method === 'PATCH') {
    // Grade a pick: { gameId, pickType, result: 'win'|'loss'|'push', actualScore }
    const { gameId, pickType, result, actualAway, actualHome } = req.body;
    if (!gameId || !pickType || !result) return res.status(400).json({ error: 'gameId, pickType, result required' });

    const data = loadData();
    const idx = data.picks.findIndex(p => p.gameId === gameId && p.pickType === pickType);
    if (idx === -1) return res.status(404).json({ error: 'Pick not found' });

    data.picks[idx].result = result;
    data.picks[idx].actualAway = actualAway;
    data.picks[idx].actualHome = actualHome;
    data.picks[idx].gradedAt = new Date().toISOString();

    saveData(data);
    return res.status(200).json({ updated: data.picks[idx] });
  }

  if (req.method === 'DELETE') {
    // Clear all picks (admin reset)
    saveData({ picks: [] });
    return res.status(200).json({ cleared: true });
  }

  res.status(405).json({ error: 'Method not allowed' });
}
