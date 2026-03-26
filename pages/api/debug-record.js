import { Redis } from '@upstash/redis';

export default async function handler(req, res) {
  const results = {};

  // 1. Check env vars
  results.hasRedisUrl = !!process.env.UPSTASH_REDIS_REST_URL;
  results.hasRedisToken = !!process.env.UPSTASH_REDIS_REST_TOKEN;
  results.redisUrlPrefix = process.env.UPSTASH_REDIS_REST_URL?.slice(0, 30) || 'NOT SET';

  if (!results.hasRedisUrl || !results.hasRedisToken) {
    return res.status(200).json({ ...results, error: 'Missing Upstash env vars' });
  }

  // 2. Test Redis connection
  try {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
    await redis.set('mlb:test', 'ok');
    const val = await redis.get('mlb:test');
    results.redisConnection = val === 'ok' ? 'success' : 'failed';

    // 3. Check what picks exist
    const picks = await redis.get('mlb:picks');
    results.picksIsNull = picks === null;
    results.picksCount = Array.isArray(picks) ? picks.length : 0;
    results.picks = Array.isArray(picks) ? picks.slice(0, 5) : picks; // show first 5

    // 4. Try grading right now
    if (Array.isArray(picks) && picks.length > 0) {
      const pending = picks.filter(p => p.result === 'pending');
      results.pendingCount = pending.length;
      results.pendingDates = [...new Set(pending.map(p => p.gameDate))];

      // Test fetching scores for one date
      if (results.pendingDates.length > 0) {
        const testDate = results.pendingDates[0];
        const mlbRes = await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${testDate}&hydrate=team,linescore`);
        const mlbData = await mlbRes.json();
        const allGames = mlbData.dates?.[0]?.games || [];
        const finalGames = allGames.filter(g => g.status?.abstractGameState?.toLowerCase() === 'final');
        results.mlbGamesOnDate = allGames.length;
        results.finalGamesOnDate = finalGames.length;
        results.sampleFinalGame = finalGames[0] ? {
          id: finalGames[0].gamePk,
          away: `${finalGames[0].teams?.away?.team?.name} ${finalGames[0].teams?.away?.score}`,
          home: `${finalGames[0].teams?.home?.team?.name} ${finalGames[0].teams?.home?.score}`,
          status: finalGames[0].status?.detailedState,
        } : null;
      }
    }
  } catch (e) {
    results.redisError = e.message;
  }

  res.status(200).json(results);
}
