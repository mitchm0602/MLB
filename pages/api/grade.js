import { redisGet, redisSet } from './_redis';

const KEY = 'mlb:picks:v3';

async function loadPicks() {
  try {
    const data = await redisGet(KEY);
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

async function getFinalGames(date) {
  try {
    const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    const games = [];
    for (const entry of (data.dates || [])) {
      for (const game of (entry.games || [])) {
        const state = (game.status?.abstractGameState || '').toLowerCase();
        const detail = (game.status?.detailedState || '').toLowerCase();
        if (state !== 'final' && !detail.includes('final')) continue;
        const away = game.teams?.away?.score;
        const home = game.teams?.home?.score;
        if (away == null || home == null) continue;
        games.push({ id: String(game.gamePk), awayScore: away, homeScore: home });
      }
    }
    return games;
  } catch (e) {
    console.error('getFinalGames error:', e.message);
    return [];
  }
}

function gradeSpread(pick, away, home) {
  const line = parseFloat(pick.line);
  if (isNaN(line)) return null;
  if (pick.pickSide === 'home') {
    const adj = home + line;
    if (adj > away) return 'win';
    if (adj === away) return 'push';
    return 'loss';
  } else {
    const needed = home - line;
    if (away > needed) return 'win';
    if (away === needed) return 'push';
    return 'loss';
  }
}

function gradeTotal(pick, away, home) {
  const runs = away + home;
  const line = parseFloat(pick.line);
  if (isNaN(line)) return null;
  if (pick.pick === 'OVER') {
    if (runs > line) return 'win';
    if (runs === line) return 'push';
    return 'loss';
  } else {
    if (runs < line) return 'win';
    if (runs === line) return 'push';
    return 'loss';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const picks = await loadPicks();
    const pending = picks.filter(p => p.result === 'pending');

    if (!pending.length) {
      return res.status(200).json({ graded: 0, message: 'No pending picks', total: picks.length });
    }

    const dates = [...new Set(pending.map(p => p.gameDate))];
    let totalGraded = 0;

    for (const date of dates) {
      const games = await getFinalGames(date);
      for (const game of games) {
        const gamePicks = pending.filter(p => String(p.gameId) === game.id);
        for (const pick of gamePicks) {
          const idx = picks.findIndex(p =>
            String(p.gameId) === game.id && p.pickType === pick.pickType
          );
          if (idx === -1) continue;

          let result = null;
          if (pick.pickType === 'spread' && pick.pickSide && pick.pickSide !== 'pass') {
            result = gradeSpread(pick, game.awayScore, game.homeScore);
          } else if (pick.pickType === 'total' && pick.pick && pick.pick !== 'PASS' && pick.pick !== 'pass') {
            result = gradeTotal(pick, game.awayScore, game.homeScore);
          } else {
            result = 'pass';
          }

          if (result) {
            picks[idx] = {
              ...picks[idx],
              result,
              actualAway: game.awayScore,
              actualHome: game.homeScore,
              gradedAt: new Date().toISOString()
            };
            totalGraded++;
          }
        }
      }
    }

    if (totalGraded > 0) await redisSet(KEY, picks);

    res.status(200).json({ graded: totalGraded, total: picks.length, pending: pending.length });
  } catch (e) {
    console.error('Grade error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
