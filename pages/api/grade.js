import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join('/tmp', 'mlb-picks.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (e) {}
  return { picks: [] };
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// Call MLB API directly — no internal fetch needed
async function getFinalGamesForDate(date) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const data = await res.json();
  const games = [];
  for (const entry of (data.dates || [])) {
    for (const game of (entry.games || [])) {
      const state = game.status?.abstractGameState?.toLowerCase();
      const detail = game.status?.detailedState?.toLowerCase() || '';
      if (state !== 'final' && !detail.includes('final')) continue;
      games.push({
        id: game.gamePk,
        awayScore: game.teams?.away?.score ?? null,
        homeScore: game.teams?.home?.score ?? null,
      });
    }
  }
  return games;
}

function gradeSpread(pick, awayScore, homeScore) {
  const line = parseFloat(pick.line);
  if (isNaN(line)) return 'pending';
  // line is from home team's perspective (e.g. -1.5 means home is favored)
  if (pick.pickSide === 'home') {
    const adj = homeScore + line;
    if (adj > awayScore) return 'win';
    if (adj === awayScore) return 'push';
    return 'loss';
  } else {
    // away team pick — away wins if they cover (away beats home - line for away dog, or away + line for home fav)
    const adj = awayScore + line; // if line is -1.5 for home, away needs awayScore > homeScore + 1.5
    // simpler: home spread is `line`, so away spread is `-line`
    const awayAdj = homeScore - line; // away needs to beat this
    if (awayScore > awayAdj) return 'win';
    if (awayScore === awayAdj) return 'push';
    return 'loss';
  }
}

function gradeTotal(pick, awayScore, homeScore) {
  const total = awayScore + homeScore;
  const line = parseFloat(pick.line);
  if (isNaN(line)) return 'pending';
  if (pick.pick === 'OVER') {
    if (total > line) return 'win';
    if (total === line) return 'push';
    return 'loss';
  } else { // UNDER
    if (total < line) return 'win';
    if (total === line) return 'push';
    return 'loss';
  }
}

export default async function handler(req, res) {
  // Allow GET for auto-grading triggers, POST for manual
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const data = loadData();
    const pending = data.picks.filter(p => p.result === 'pending');

    if (!pending.length) {
      return res.status(200).json({ graded: 0, message: 'No pending picks' });
    }

    const dates = [...new Set(pending.map(p => p.gameDate))];
    let totalGraded = 0;

    for (const date of dates) {
      const finalGames = await getFinalGamesForDate(date);
      if (!finalGames.length) continue;

      for (const game of finalGames) {
        if (game.awayScore === null || game.homeScore === null) continue;
        const gamePicks = pending.filter(p => p.gameId == game.id);

        for (const pick of gamePicks) {
          const idx = data.picks.findIndex(p => p.gameId == game.id && p.pickType === pick.pickType);
          if (idx === -1) continue;

          let result = 'pending';
          if (pick.pickType === 'spread' && pick.pickSide !== 'pass') {
            result = gradeSpread(pick, game.awayScore, game.homeScore);
          } else if (pick.pickType === 'total' && pick.pick !== 'PASS') {
            result = gradeTotal(pick, game.awayScore, game.homeScore);
          } else {
            result = 'pass';
          }

          if (result !== 'pending') {
            data.picks[idx].result = result;
            data.picks[idx].actualAway = game.awayScore;
            data.picks[idx].actualHome = game.homeScore;
            data.picks[idx].gradedAt = new Date().toISOString();
            totalGraded++;
          }
        }
      }
    }

    saveData(data);
    res.status(200).json({ graded: totalGraded, total: data.picks.length });
  } catch (e) {
    console.error('Grade error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
