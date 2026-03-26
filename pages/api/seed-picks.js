// Seed historical picks that predate the storage system
// Safe to run multiple times - won't duplicate
import { redisGet, redisSet } from './_redis';

const KEY = 'mlb:picks:v3';

// March 25: NYY @ SF — final NYY 7, SF 0
// NYY +1.5 = WIN (NYY won outright)
// Under 8.5 = WIN (total 7 < 8.5)
const HISTORICAL_PICKS = [
  {
    gameId: '75e97ab9-6335-4320-906a-ed279bd561cb',
    gameDate: '2026-03-25',
    awayTeam: 'New York Yankees',
    homeTeam: 'San Francisco Giants',
    awayAbbrev: 'NYY',
    homeAbbrev: 'SF',
    pickType: 'spread',
    pick: 'New York Yankees',
    pickSide: 'away',
    line: '+1.5',
    confidence: 7,
    edge: 'Yankees +1.5 as road underdog with strong lineup.',
    result: 'win',
    actualAway: 7,
    actualHome: 0,
    savedAt: '2026-03-25T19:05:00.000Z',
    gradedAt: '2026-03-25T23:00:00.000Z',
    seeded: true,
  },
  {
    gameId: '75e97ab9-6335-4320-906a-ed279bd561cb',
    gameDate: '2026-03-25',
    awayTeam: 'New York Yankees',
    homeTeam: 'San Francisco Giants',
    awayAbbrev: 'NYY',
    homeAbbrev: 'SF',
    pickType: 'total',
    pick: 'UNDER',
    line: 8.5,
    confidence: 7,
    edge: 'Under 8.5 with two solid starters at pitcher-friendly Oracle Park.',
    result: 'win',
    actualAway: 7,
    actualHome: 0,
    savedAt: '2026-03-25T19:05:00.000Z',
    gradedAt: '2026-03-25T23:00:00.000Z',
    seeded: true,
  }
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({
      message: 'POST to seed March 25 historical picks (NYY @ SF)',
      picks: HISTORICAL_PICKS.map(p => `${p.pickType}: ${p.pick} ${p.line} → ${p.result}`)
    });
  }

  try {
    const existing = await redisGet(KEY) || [];

    let added = 0;
    for (const pick of HISTORICAL_PICKS) {
      const exists = existing.find(p =>
        String(p.gameId) === String(pick.gameId) && p.pickType === pick.pickType
      );
      if (!exists) {
        existing.push(pick);
        added++;
      }
    }

    await redisSet(KEY, existing);
    res.status(200).json({
      message: `Added ${added} historical picks`,
      total: existing.length,
      seeded: HISTORICAL_PICKS.map(p => `${p.awayAbbrev}@${p.homeAbbrev} ${p.pickType} → ${p.result}`)
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
