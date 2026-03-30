// Triggered by Vercel Cron at 1pm Central (19:00 UTC)
// Fetches today's games and runs analysis on all of them

export const config = { maxDuration: 300 }; // 5 min max

export default async function handler(req, res) {
  // Vercel cron sends GET with Authorization header
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const today = new Date();
    // Convert to Central time for the date
    const centralDate = new Date(today.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const dateStr = `${centralDate.getFullYear()}-${String(centralDate.getMonth()+1).padStart(2,'0')}-${String(centralDate.getDate()).padStart(2,'0')}`;

    console.log(`Cron: starting analysis for ${dateStr}`);

    // Fetch today's games
    const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000';
    const scoresRes = await fetch(`${baseUrl}/api/scores?date=${dateStr}`);
    if (!scoresRes.ok) throw new Error(`Scores fetch failed: ${scoresRes.status}`);
    const scoresData = await scoresRes.json();

    const games = (scoresData.games || []).filter(g =>
      g.status !== 'final' && g.status !== 'postponed'
    );

    if (!games.length) {
      return res.status(200).json({ message: 'No games to analyze', date: dateStr });
    }

    // Fetch odds in parallel
    const oddsRes = await fetch(`${baseUrl}/api/odds`);
    const oddsData = oddsRes.ok ? await oddsRes.json() : { odds: [] };

    // Build odds map
    const oddsMap = {};
    for (const game of games) {
      const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
      const mlbLast = game.home.name.split(' ').pop().toLowerCase();
      const match = (oddsData.odds || []).find(og =>
        norm(og.homeTeam) === norm(game.home.name) ||
        og.homeTeam.toLowerCase().includes(mlbLast) ||
        og.awayTeam.toLowerCase().includes(mlbLast)
      );
      if (match) {
        const hh = match.homeTeam.toLowerCase().includes(mlbLast);
        oddsMap[game.id] = {
          homeSpread: hh ? match.spread.homePoint : match.spread.awayPoint,
          total: match.total.point,
        };
      }
    }

    // Store results in Redis
    const { redisGet, redisSet } = await import('./_redis.js');
    const CACHE_KEY = `mlb-cron-analysis-${dateStr}`;

    const results = {};
    let analyzed = 0;
    let failed = 0;

    for (let i = 0; i < games.length; i++) {
      const game = games[i];
      if (i > 0) await new Promise(r => setTimeout(r, 8000)); // 8s between to avoid rate limits

      try {
        const odds = oddsMap[game.id] || {};
        const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            homeTeam: game.home.name,
            awayTeam: game.away.name,
            gameDate: dateStr,
            homeSpread: odds.homeSpread ?? null,
            total: odds.total ?? null,
          })
        });

        if (!analyzeRes.ok) throw new Error(`HTTP ${analyzeRes.status}`);
        const result = await analyzeRes.json();
        results[game.id] = result;
        analyzed++;

        // Save picks to Redis immediately
        const picksToSave = [];
        if (result.spread?.pickSide && result.spread?.pick) {
          picksToSave.push({
            gameId: game.id,
            gameDate: dateStr,
            awayTeam: game.away.name,
            homeTeam: game.home.name,
            awayAbbrev: game.away.abbrev,
            homeAbbrev: game.home.abbrev,
            pickType: 'spread',
            pick: result.spread.pick,
            pickSide: result.spread.pickSide,
            line: result.spread.line,
            confidence: result.spread.confidence,
            edge: result.spread.edge,
            result: 'pending',
          });
        }
        if (result.total?.pick && !['PASS','pass'].includes(result.total.pick)) {
          picksToSave.push({
            gameId: game.id,
            gameDate: dateStr,
            awayTeam: game.away.name,
            homeTeam: game.home.name,
            awayAbbrev: game.away.abbrev,
            homeAbbrev: game.home.abbrev,
            pickType: 'total',
            pick: result.total.pick,
            line: result.total.line,
            confidence: result.total.confidence,
            edge: result.total.edge,
            result: 'pending',
          });
        }
        if (picksToSave.length) {
          await fetch(`${baseUrl}/api/picks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ picks: picksToSave })
          });
        }
      } catch (e) {
        console.error(`Failed to analyze ${game.away.name} @ ${game.home.name}:`, e.message);
        failed++;
      }
    }

    // Cache results so scoreboard loads instantly
    await redisSet(CACHE_KEY, { results, analyzedAt: new Date().toISOString() });

    res.status(200).json({
      date: dateStr,
      gamesFound: games.length,
      analyzed,
      failed,
      message: `Analysis complete for ${dateStr}`
    });

  } catch (e) {
    console.error('Cron error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
