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

function gradeSpread(pick, awayScore, homeScore) {
  // pick.pickSide: 'away' | 'home', pick.line: e.g. "-1.5" for home
  const line = parseFloat(pick.line);
  const homeAdj = homeScore + line; // apply spread to home
  if (pick.pickSide === 'home') {
    if (homeAdj > awayScore) return 'win';
    if (homeAdj === awayScore) return 'push';
    return 'loss';
  } else {
    // away covers if away beats home + spread
    if (awayScore > homeScore + line) return 'win'; // line is negative for home fav, so away + abs(line) must cover
    if (awayScore === homeScore + line) return 'push';
    return 'loss';
  }
}

function gradeTotal(pick, awayScore, homeScore) {
  const total = awayScore + homeScore;
  const line = parseFloat(pick.line);
  if (pick.pick === 'OVER') {
    if (total > line) return 'win';
    if (total === line) return 'push';
    return 'loss';
  } else {
    if (total < line) return 'win';
    if (total === line) return 'push';
    return 'loss';
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = loadData();
    const pending = data.picks.filter(p => p.result === 'pending');

    if (!pending.length) return res.status(200).json({ graded: 0, message: 'No pending picks' });

    // Get unique dates with pending picks
    const dates = [...new Set(pending.map(p => p.gameDate))];
    let totalGraded = 0;

    for (const date of dates) {
      // Fetch scores for this date
      const scoresRes = await fetch(`${process.env.VERCEL_URL ? 'https://' + process.env.VERCEL_URL : 'http://localhost:3000'}/api/scores?date=${date}`);
      if (!scoresRes.ok) continue;
      const scoresData = await scoresRes.json();
      const finalGames = (scoresData.games || []).filter(g => g.status === 'final');

      for (const game of finalGames) {
        const gamePicks = pending.filter(p => p.gameId === game.id);
        for (const pick of gamePicks) {
          const idx = data.picks.findIndex(p => p.gameId === pick.gameId && p.pickType === pick.pickType);
          if (idx === -1) continue;

          const awayScore = game.away.score;
          const homeScore = game.home.score;

          let result = 'pending';
          if (pick.pickType === 'spread' && pick.pickSide !== 'pass') {
            result = gradeSpread(pick, awayScore, homeScore);
          } else if (pick.pickType === 'total' && pick.pick !== 'PASS') {
            result = gradeTotal(pick, awayScore, homeScore);
          } else {
            result = 'pass'; // skip PASS picks
          }

          data.picks[idx].result = result;
          data.picks[idx].actualAway = awayScore;
          data.picks[idx].actualHome = homeScore;
          data.picks[idx].gradedAt = new Date().toISOString();
          totalGraded++;
        }
      }
    }

    saveData(data);
    res.status(200).json({ graded: totalGraded });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
