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
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([JSON.stringify(value)])
  });
  return res.json();
}

export default async function handler(req, res) {
  const results = {};

  results.hasRedisUrl = !!process.env.mlb_KV_REST_API_URL;
  results.hasRedisToken = !!process.env.mlb_KV_REST_API_TOKEN;
  results.redisUrlPrefix = process.env.mlb_KV_REST_API_URL?.slice(0, 40) || 'NOT SET';

  if (!results.hasRedisUrl || !results.hasRedisToken) {
    return res.status(200).json({ ...results, error: 'Missing env vars' });
  }

  // Test write
  try {
    const writeRes = await redisSet('mlb:test', { ok: true, ts: Date.now() });
    results.writeResult = writeRes;
  } catch (e) {
    results.writeError = e.message;
    return res.status(200).json(results);
  }

  // Test read
  try {
    const val = await redisGet('mlb:test');
    results.readResult = val;
    results.redisConnection = val?.ok === true ? 'success' : 'unexpected value';
  } catch (e) {
    results.readError = e.message;
    return res.status(200).json(results);
  }

  // Check picks
  try {
    const picks = await redisGet('mlb:picks');
    results.picksIsNull = picks === null;
    results.picksCount = Array.isArray(picks) ? picks.length : 0;
    results.recentPicks = Array.isArray(picks) ? picks.slice(-3) : null;

    if (Array.isArray(picks) && picks.length > 0) {
      const pending = picks.filter(p => p.result === 'pending');
      results.pendingCount = pending.length;
      results.pendingDates = [...new Set(pending.map(p => p.gameDate))];

      if (results.pendingDates.length > 0) {
        const testDate = results.pendingDates[0];
        const mlbRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${testDate}&hydrate=team,linescore`);
        const mlbData = await mlbRes.json();
        const allGames = mlbData.dates?.[0]?.games || [];
        const finalGames = allGames.filter(g =>
          g.status?.abstractGameState?.toLowerCase() === 'final' ||
          g.status?.detailedState?.toLowerCase().includes('final')
        );
        results.mlbDate = testDate;
        results.mlbGamesTotal = allGames.length;
        results.mlbFinalGames = finalGames.length;
        results.sampleFinal = finalGames[0] ? {
          id: finalGames[0].gamePk,
          away: `${finalGames[0].teams?.away?.team?.name} ${finalGames[0].teams?.away?.score}`,
          home: `${finalGames[0].teams?.home?.team?.name} ${finalGames[0].teams?.home?.score}`,
        } : null;

        // Check if game IDs match
        if (finalGames.length > 0 && pending.length > 0) {
          const finalIds = finalGames.map(g => String(g.gamePk));
          const pendingIds = pending.map(p => String(p.gameId));
          results.idOverlap = pendingIds.filter(id => finalIds.includes(id));
          results.samplePendingId = pendingIds[0];
          results.sampleFinalId = finalIds[0];
        }
      }
    }
  } catch (e) {
    results.picksError = e.message;
  }

  res.status(200).json(results);
}
