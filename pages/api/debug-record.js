import { redisGet, redisSet } from './_redis';

export default async function handler(req, res) {
  const results = {
    hasRedisUrl: !!process.env.mlb_KV_REST_API_URL,
    hasRedisToken: !!process.env.mlb_KV_REST_API_TOKEN,
  };

  try {
    // Test write/read roundtrip
    await redisSet('mlb:test', { ok: true, ts: Date.now() });
    const val = await redisGet('mlb:test');
    results.redisConnection = val?.ok === true ? 'success' : 'unexpected: ' + JSON.stringify(val);

    // Check v2 picks
    const picks = await redisGet('mlb:picks:v3');
    results.picksV2Count = Array.isArray(picks) ? picks.length : `not array: ${typeof picks}`;
    results.recentPicks = Array.isArray(picks) ? picks.slice(-3) : null;

    if (Array.isArray(picks)) {
      const pending = picks.filter(p => p.result === 'pending');
      const wins = picks.filter(p => p.result === 'win').length;
      const losses = picks.filter(p => p.result === 'loss').length;
      results.pending = pending.length;
      results.wins = wins;
      results.losses = losses;
      results.pendingDates = [...new Set(pending.map(p => p.gameDate))];
    }
  } catch (e) {
    results.error = e.message;
  }

  res.status(200).json(results);
}
