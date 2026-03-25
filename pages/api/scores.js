export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Simplified hydrate string - avoid complex nested params that MLB API rejects
    const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${targetDate}&hydrate=team,linescore,probablePitcher,weather`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response;
    try {
      response = await fetch(mlbUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MLB-Edge/1.0)',
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`MLB API error ${response.status}: ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const games = [];

    for (const dateEntry of (data.dates || [])) {
      for (const game of (dateEntry.games || [])) {
        const linescore = game.linescore || {};
        const teams = game.teams || {};
        const home = teams.home || {};
        const away = teams.away || {};
        const weather = game.weather || {};

        games.push({
          id: game.gamePk,
          status: mapStatus(game.status?.abstractGameState, game.status?.detailedState),
          detailedStatus: game.status?.detailedState || '',
          inning: linescore.currentInning || null,
          inningHalf: linescore.inningHalf || null,
          startTime: game.gameDate,
          venue: game.venue?.name || '',
          weather: weather.condition ? `${weather.condition}, ${weather.temp}°F, Wind: ${weather.wind}` : null,
          home: {
            id: home.team?.id,
            name: home.team?.name || '',
            abbrev: home.team?.abbreviation || '',
            score: home.score ?? null,
            record: home.leagueRecord ? `${home.leagueRecord.wins}-${home.leagueRecord.losses}` : '',
            probablePitcher: home.probablePitcher
              ? { name: home.probablePitcher.fullName, era: '—' }
              : null,
            hits: linescore.teams?.home?.hits ?? null,
            errors: linescore.teams?.home?.errors ?? null,
          },
          away: {
            id: away.team?.id,
            name: away.team?.name || '',
            abbrev: away.team?.abbreviation || '',
            score: away.score ?? null,
            record: away.leagueRecord ? `${away.leagueRecord.wins}-${away.leagueRecord.losses}` : '',
            probablePitcher: away.probablePitcher
              ? { name: away.probablePitcher.fullName, era: '—' }
              : null,
            hits: linescore.teams?.away?.hits ?? null,
            errors: linescore.teams?.away?.errors ?? null,
          },
          outs: linescore.outs ?? null,
          balls: linescore.balls ?? null,
          strikes: linescore.strikes ?? null,
          onFirst: !!linescore.offense?.first,
          onSecond: !!linescore.offense?.second,
          onThird: !!linescore.offense?.third,
        });
      }
    }

    games.sort((a, b) => {
      const order = { live: 0, scheduled: 1, final: 2 };
      const ao = order[a.status] ?? 3;
      const bo = order[b.status] ?? 3;
      if (ao !== bo) return ao - bo;
      return new Date(a.startTime) - new Date(b.startTime);
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ games, date: targetDate, fetchedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Scores API error:', error.message);
    res.status(500).json({ error: error.message });
  }
}

function mapStatus(abstractState, detailedState) {
  if (!abstractState) return 'scheduled';
  const s = abstractState.toLowerCase();
  const d = (detailedState || '').toLowerCase();
  if (s === 'live') return 'live';
  if (s === 'final' || d.includes('final') || d.includes('completed')) return 'final';
  if (d.includes('postponed')) return 'postponed';
  if (d.includes('suspended')) return 'suspended';
  return 'scheduled';
}
