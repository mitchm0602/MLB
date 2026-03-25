export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ odds: [], error: 'ODDS_API_KEY not configured', fetchedAt: new Date().toISOString() });
  }

  try {
    // Fetch moneyline + spreads + totals in one call
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm,caesars`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let response;
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      return res.status(200).json({ odds: [], error: `Odds API error ${response.status}`, fetchedAt: new Date().toISOString() });
    }

    const data = await response.json();
    const odds = [];

    for (const event of data) {
      const game = {
        id: event.id,
        homeTeam: event.home_team,
        awayTeam: event.away_team,
        commenceTime: event.commence_time,
        moneyline: { home: null, away: null },
        spread: { home: null, away: null, homePoint: null, awayPoint: null },
        total: { over: null, under: null, point: null },
        favored: null,
      };

      // Aggregate across bookmakers — average the lines
      const mlHome = [], mlAway = [];
      const spHome = [], spAway = [], spPoint = [];
      const totOver = [], totUnder = [], totPoint = [];

      for (const bookmaker of (event.bookmakers || [])) {
        for (const market of (bookmaker.markets || [])) {
          if (market.key === 'h2h') {
            for (const outcome of market.outcomes) {
              if (outcome.name === event.home_team) mlHome.push(outcome.price);
              if (outcome.name === event.away_team) mlAway.push(outcome.price);
            }
          }
          if (market.key === 'spreads') {
            for (const outcome of market.outcomes) {
              if (outcome.name === event.home_team) {
                spHome.push(outcome.price);
                spPoint.push(outcome.point);
              }
              if (outcome.name === event.away_team) {
                spAway.push(outcome.price);
              }
            }
          }
          if (market.key === 'totals') {
            for (const outcome of market.outcomes) {
              if (outcome.name === 'Over') {
                totOver.push(outcome.price);
                totPoint.push(outcome.point);
              }
              if (outcome.name === 'Under') totUnder.push(outcome.price);
            }
          }
        }
      }

      const avg = arr => arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null;
      const avgF = arr => arr.length ? parseFloat((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1)) : null;

      game.moneyline.home = avg(mlHome);
      game.moneyline.away = avg(mlAway);
      game.spread.home = avg(spHome);
      game.spread.away = avg(spAway);
      game.spread.homePoint = avgF(spPoint);
      game.spread.awayPoint = spPoint.length ? parseFloat((-avgF(spPoint)).toFixed(1)) : null;
      game.total.over = avg(totOver);
      game.total.under = avg(totUnder);
      game.total.point = avgF(totPoint);

      // Determine favored team from moneyline
      if (game.moneyline.home !== null && game.moneyline.away !== null) {
        game.favored = game.moneyline.home < game.moneyline.away ? 'home' : 'away';
      } else if (game.spread.homePoint !== null) {
        game.favored = game.spread.homePoint < 0 ? 'home' : 'away';
      }

      odds.push(game);
    }

    // Log remaining requests
    const remaining = response.headers.get('x-requests-remaining');
    const used = response.headers.get('x-requests-used');
    console.log(`Odds API: ${used} used, ${remaining} remaining`);

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ odds, fetchedAt: new Date().toISOString(), remaining });

  } catch (error) {
    console.error('Odds API error:', error.message);
    res.status(200).json({ odds: [], error: error.message, fetchedAt: new Date().toISOString() });
  }
}
