import Anthropic from '@anthropic-ai/sdk';
import { redisGet, redisSet } from './_redis';

export const config = { maxDuration: 60 }; // 60s per invocation — analyzes ONE game

const PICKS_KEY = 'mlb:picks:v3';
const QUEUE_KEY = date => `mlb-queue-${date}`;
const RESULTS_KEY = date => `mlb-cron-analysis-${date}`;

// ── MLB data ──────────────────────────────────────────────────────────────

async function getTodayGames(dateStr) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=team,linescore,probablePitcher`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const data = await res.json();
  const games = [];
  for (const entry of (data.dates || [])) {
    for (const g of (entry.games || [])) {
      const state = (g.status?.abstractGameState || '').toLowerCase();
      if (state === 'final') continue;
      games.push({
        id: String(g.gamePk),
        status: state,
        home: {
          name: g.teams?.home?.team?.name || '',
          abbrev: g.teams?.home?.team?.abbreviation || '',
          probablePitcher: g.teams?.home?.probablePitcher?.fullName || null
        },
        away: {
          name: g.teams?.away?.team?.name || '',
          abbrev: g.teams?.away?.team?.abbreviation || '',
          probablePitcher: g.teams?.away?.probablePitcher?.fullName || null
        },
      });
    }
  }
  return games;
}

async function getOddsForGame(homeName) {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return { homeSpread: null, total: null };
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=spreads,totals&oddsFormat=american&bookmakers=draftkings`;
    const res = await fetch(url);
    if (!res.ok) return { homeSpread: null, total: null };
    const events = await res.json();
    const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
    const homeLast = homeName.split(' ').pop().toLowerCase();
    const ev = events.find(e => norm(e.home_team) === norm(homeName) || e.home_team.toLowerCase().includes(homeLast));
    if (!ev) return { homeSpread: null, total: null };
    let homeSpread = null, total = null;
    for (const bm of (ev.bookmakers || [])) {
      for (const mkt of (bm.markets || [])) {
        if (mkt.key === 'spreads' && homeSpread === null) {
          const ho = mkt.outcomes.find(o => o.name === ev.home_team);
          if (ho) homeSpread = ho.point;
        }
        if (mkt.key === 'totals' && total === null) {
          const ov = mkt.outcomes.find(o => o.name === 'Over');
          if (ov) total = ov.point;
        }
      }
      if (homeSpread !== null && total !== null) break;
    }
    return { homeSpread, total };
  } catch { return { homeSpread: null, total: null }; }
}

// ── Analysis ──────────────────────────────────────────────────────────────

async function analyzeOneGame(game, odds, dateStr) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const spreadInfo = odds.homeSpread != null
    ? `Spread: ${game.home.name} ${odds.homeSpread > 0 ? '+' : ''}${odds.homeSpread} / ${game.away.name} ${odds.homeSpread <= 0 ? '+' : '-'}${Math.abs(odds.homeSpread)}`
    : 'No spread line yet';
  const totalInfo = odds.total != null ? `O/U: ${odds.total}` : 'No total yet';
  const pitcherInfo = (game.away.probablePitcher || game.home.probablePitcher)
    ? `Probable starters: ${game.away.abbrev} ${game.away.probablePitcher || 'TBD'} vs ${game.home.abbrev} ${game.home.probablePitcher || 'TBD'}`
    : '';

  const systemPrompt = `You are a sharp MLB betting analyst for the 2026 regular season. Make a pick on BOTH spread and total — never PASS. Low conviction = confidence 1-3. Only use 2026 regular season data. Never use spring training or 2025 data. Find VALUE: public bets favorites/overs, sharp money fades the public.

Return ONLY valid JSON (no markdown, no backticks):
{"spread":{"pick":"FULL TEAM NAME","pickSide":"away or home","line":"-1.5","confidence":7,"edge":"Specific reason."},"total":{"pick":"OVER or UNDER","line":8.5,"confidence":6,"predictedRuns":7.2,"edge":"Specific reason."},"predictedScore":{"away":4,"home":3},"pitchers":{"away":{"name":"name","era":"x.xx","note":"recent form"},"home":{"name":"name","era":"x.xx","note":"recent form"}},"keyInjuries":[{"team":"away or home","player":"name","status":"IL10","impact":"high"}],"topFactors":[{"label":"label","detail":"one sentence","side":"away or home or over or under or neutral"}],"teamStats":{"away":{"record":"W-L","last10":"W-L","rpg":"x.x","era":"x.xx","ops":".xxx"},"home":{"record":"W-L","last10":"W-L","rpg":"x.x","era":"x.xx","ops":".xxx"}},"weather":"ballpark, wind, temp","summary":"2 sharp sentences."}`;

  const userMessage = `TODAY: ${today}. 2026 MLB regular season is underway.

Search for current data then analyze:
${game.away.name} @ ${game.home.name} — ${dateStr}
${pitcherInfo}
${spreadInfo}
${totalInfo}

Search for: confirmed starters, injury reports, 2026 team stats, weather. Pick both spread and total. Return JSON only.`;

  // Try Sonnet with web search first
  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' }
    });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });
    let text = '';
    for (const block of (message.content || [])) {
      if (block.type === 'text') text += block.text;
    }
    return parseResult(text);
  } catch (e) {
    // Rate limit or error — fall back to Haiku
    console.log(`Sonnet failed (${e.status}), using Haiku`);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `${game.away.name} @ ${game.home.name} on ${dateStr}. ${spreadInfo}. ${totalInfo}. Pick both, return JSON only.` }]
    });
    return parseResult(message.content?.[0]?.text || '');
  }
}

function parseResult(text) {
  text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  // Try direct parse, then repair trailing commas
  try { return JSON.parse(match[0]); } catch {
    const fixed = match[0].replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(fixed);
  }
}

function sanitize(result, game) {
  if (!result.spread?.pickSide || ['pass','PASS'].includes(result.spread.pickSide)) {
    result.spread = { ...result.spread, pickSide: 'away', pick: game.away.name, confidence: 2, edge: 'Low conviction — away +1.5 value.' };
  }
  if (!result.total?.pick || ['PASS','pass'].includes(result.total.pick)) {
    result.total = { ...result.total, pick: 'UNDER', confidence: 2, edge: 'Low conviction — default under.' };
  }
  return result;
}

// ── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Auth: Vercel cron header OR CRON_SECRET
  const secret = process.env.CRON_SECRET;
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const hasSecret = secret && req.headers.authorization === `Bearer ${secret}`;
  if (!isVercelCron && !hasSecret && secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const dateStr = `${central.getFullYear()}-${String(central.getMonth()+1).padStart(2,'0')}-${String(central.getDate()).padStart(2,'0')}`;

    // ── Step 1: Check if queue exists, if not build it ──
    let queue = await redisGet(QUEUE_KEY(dateStr));

    if (!queue || !Array.isArray(queue) || queue.length === 0) {
      // Build queue from today's games
      console.log(`Building queue for ${dateStr}`);
      const games = await getTodayGames(dateStr);
      if (!games.length) {
        return res.status(200).json({ message: 'No games today', date: dateStr });
      }
      queue = games.map(g => ({ ...g, queued: true }));
      await redisSet(QUEUE_KEY(dateStr), queue);
      console.log(`Queued ${queue.length} games`);
    }

    // ── Step 2: Process next unanalyzed game ──
    const nextGame = queue.find(g => g.queued);
    if (!nextGame) {
      return res.status(200).json({ message: 'All games analyzed', date: dateStr });
    }

    console.log(`Analyzing: ${nextGame.away.name} @ ${nextGame.home.name}`);

    // Mark as in-progress
    const updatedQueue = queue.map(g => g.id === nextGame.id ? { ...g, queued: false, processing: true } : g);
    await redisSet(QUEUE_KEY(dateStr), updatedQueue);

    // Get odds and analyze
    const odds = await getOddsForGame(nextGame.home.name);
    let result;
    try {
      result = sanitize(await analyzeOneGame(nextGame, odds, dateStr), nextGame);
    } catch (e) {
      console.error(`Analysis failed for ${nextGame.away.name} @ ${nextGame.home.name}:`, e.message);
      result = { error: e.message };
    }

    // ── Step 3: Save result ──
    const existingResults = await redisGet(RESULTS_KEY(dateStr)) || { results: {}, date: dateStr };
    existingResults.results[nextGame.id] = { ...result, analyzedAt: new Date().toISOString() };
    existingResults.analyzedAt = new Date().toISOString();

    // Save picks to Redis
    if (result && !result.error) {
      const existingPicks = await redisGet(PICKS_KEY) || [];
      const picksToSave = [];
      if (result.spread?.pickSide && result.spread?.pick) {
        picksToSave.push({ gameId: nextGame.id, gameDate: dateStr, awayTeam: nextGame.away.name, homeTeam: nextGame.home.name, awayAbbrev: nextGame.away.abbrev, homeAbbrev: nextGame.home.abbrev, pickType: 'spread', pick: result.spread.pick, pickSide: result.spread.pickSide, line: result.spread.line, confidence: result.spread.confidence, edge: result.spread.edge, result: 'pending', savedAt: new Date().toISOString() });
      }
      if (result.total?.pick && !['PASS','pass'].includes(result.total.pick)) {
        picksToSave.push({ gameId: nextGame.id, gameDate: dateStr, awayTeam: nextGame.away.name, homeTeam: nextGame.home.name, awayAbbrev: nextGame.away.abbrev, homeAbbrev: nextGame.home.abbrev, pickType: 'total', pick: result.total.pick, line: result.total.line, confidence: result.total.confidence, edge: result.total.edge, result: 'pending', savedAt: new Date().toISOString() });
      }
      if (picksToSave.length) {
        const allPicks = [...existingPicks];
        for (const pick of picksToSave) {
          const idx = allPicks.findIndex(p => String(p.gameId) === String(nextGame.id) && p.pickType === pick.pickType);
          if (idx >= 0 && allPicks[idx].result === 'pending') allPicks[idx] = pick;
          else if (idx === -1) allPicks.push(pick);
        }
        await redisSet(PICKS_KEY, allPicks);
      }
    }

    // Mark game as done in queue
    const finalQueue = updatedQueue.map(g => g.id === nextGame.id ? { ...g, processing: false, done: true, queued: false } : g);
    await Promise.all([
      redisSet(QUEUE_KEY(dateStr), finalQueue),
      redisSet(RESULTS_KEY(dateStr), existingResults)
    ]);

    const remaining = finalQueue.filter(g => g.queued).length;
    console.log(`Done: ${nextGame.away.name} @ ${nextGame.home.name}. ${remaining} games remaining.`);

    res.status(200).json({
      date: dateStr,
      analyzed: `${nextGame.away.name} @ ${nextGame.home.name}`,
      remaining,
      done: remaining === 0
    });

  } catch (e) {
    console.error('Cron error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
