import Anthropic from '@anthropic-ai/sdk';
import { redisGet, redisSet } from './_redis';

export const config = { maxDuration: 300 };

const PICKS_KEY = 'mlb:picks:v3';
const CRON_KEY = date => `mlb-cron-analysis-${date}`;

// ── Inline helpers (no internal fetch needed) ─────────────────────────────

async function getTodayGames(dateStr) {
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${dateStr}&hydrate=team,linescore,probablePitcher,weather`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];
  const data = await res.json();
  const games = [];
  for (const entry of (data.dates || [])) {
    for (const g of (entry.games || [])) {
      const state = (g.status?.abstractGameState || '').toLowerCase();
      if (state === 'final') continue;
      games.push({
        id: g.gamePk,
        status: state,
        startTime: g.gameDate,
        home: { name: g.teams?.home?.team?.name || '', abbrev: g.teams?.home?.team?.abbreviation || '', probablePitcher: g.teams?.home?.probablePitcher?.fullName || null },
        away: { name: g.teams?.away?.team?.name || '', abbrev: g.teams?.away?.team?.abbreviation || '', probablePitcher: g.teams?.away?.probablePitcher?.fullName || null },
      });
    }
  }
  return games;
}

async function getTodayOdds() {
  const apiKey = process.env.ODDS_API_KEY;
  if (!apiKey) return [];
  try {
    const url = `https://api.the-odds-api.com/v4/sports/baseball_mlb/odds/?apiKey=${apiKey}&regions=us&markets=h2h,spreads,totals&oddsFormat=american&bookmakers=draftkings,fanduel,betmgm`;
    const res = await fetch(url);
    if (!res.ok) return [];
    return await res.json();
  } catch { return []; }
}

function matchOdds(game, oddsEvents) {
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const homeLast = game.home.name.split(' ').pop().toLowerCase();
  for (const ev of oddsEvents) {
    if (norm(ev.home_team) === norm(game.home.name) || ev.home_team.toLowerCase().includes(homeLast) || ev.away_team.toLowerCase().includes(homeLast)) {
      const hh = ev.home_team.toLowerCase().includes(homeLast);
      let homeSpread = null, total = null;
      for (const bm of (ev.bookmakers || [])) {
        for (const mkt of (bm.markets || [])) {
          if (mkt.key === 'spreads' && homeSpread === null) {
            const ho = mkt.outcomes.find(o => o.name === ev.home_team);
            if (ho) homeSpread = hh ? ho.point : -ho.point;
          }
          if (mkt.key === 'totals' && total === null) {
            const ov = mkt.outcomes.find(o => o.name === 'Over');
            if (ov) total = ov.point;
          }
        }
        if (homeSpread !== null && total !== null) break;
      }
      return { homeSpread, total };
    }
  }
  return { homeSpread: null, total: null };
}

async function analyzeGame(game, odds, dateStr) {
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' }
  });

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const spreadInfo = odds.homeSpread != null
    ? `Spread: ${game.home.name} ${odds.homeSpread > 0 ? '+' : ''}${odds.homeSpread} / ${game.away.name} ${odds.homeSpread >= 0 ? '-' : '+'}${Math.abs(odds.homeSpread)}`
    : 'No spread line yet';
  const totalInfo = odds.total != null ? `O/U: ${odds.total}` : 'No total yet';
  const pitcherInfo = (game.away.probablePitcher || game.home.probablePitcher)
    ? `Probable starters: ${game.away.abbrev} ${game.away.probablePitcher || 'TBD'} vs ${game.home.abbrev} ${game.home.probablePitcher || 'TBD'}`
    : '';

  const systemPrompt = `You are a sharp MLB betting analyst for the 2026 regular season. Make a pick on BOTH spread and total — never PASS. Low conviction = confidence 1-3.

CRITICAL: Use ONLY 2026 regular season data. Search for TODAY's confirmed lineups, injuries, and pitcher info. Never use spring training or 2025 data.

Find VALUE: public bets favorites/overs, sharp money fades the public. Big-market teams (NYY, LAD, BOS, CHC) lines are inflated. Road +1.5 covers 50%+ historically.

Return ONLY valid JSON:
{"spread":{"pick":"FULL TEAM NAME","pickSide":"away or home","line":"-1.5","confidence":7,"edge":"Specific reason with live data."},"total":{"pick":"OVER or UNDER","line":8.5,"confidence":6,"predictedRuns":7.2,"edge":"Specific reason."},"predictedScore":{"away":4,"home":3},"pitchers":{"away":{"name":"name","era":"era","note":"recent form"},"home":{"name":"name","era":"era","note":"recent form"}},"keyInjuries":[{"team":"away or home","player":"name","status":"IL10","impact":"high"}],"topFactors":[{"label":"label","detail":"detail","side":"away or home or over or under or neutral"}],"teamStats":{"away":{"record":"W-L","last10":"W-L","rpg":"x.x","era":"x.xx","ops":".xxx"},"home":{"record":"W-L","last10":"W-L","rpg":"x.x","era":"x.xx","ops":".xxx"}},"weather":"ballpark, wind, temp","summary":"2 sharp sentences on value."}`;

  const userMessage = `TODAY: ${today}. 2026 MLB regular season.

Search for latest data then analyze:
${game.away.name} @ ${game.home.name} — ${dateStr}
${pitcherInfo}
${spreadInfo}
${totalInfo}

Search: confirmed starters, injury reports, 2026 team stats, weather. Pick both spread and total. Return JSON only.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  let fullText = '';
  for (const block of (message.content || [])) {
    if (block.type === 'text') fullText += block.text;
  }
  fullText = fullText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON in response');
  return JSON.parse(match[0]);
}

// ── Main handler ──────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // Accept GET (Vercel cron) or POST (manual trigger)
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const now = new Date();
    const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const dateStr = `${central.getFullYear()}-${String(central.getMonth()+1).padStart(2,'0')}-${String(central.getDate()).padStart(2,'0')}`;

    console.log(`Cron starting for ${dateStr}`);

    const [games, oddsEvents] = await Promise.all([getTodayGames(dateStr), getTodayOdds()]);
    const schedulable = games.filter(g => g.status !== 'final');

    if (!schedulable.length) {
      return res.status(200).json({ message: 'No games to analyze', date: dateStr });
    }

    // Load existing picks to avoid re-saving duplicates
    const existingPicks = await redisGet(PICKS_KEY) || [];
    const allPicks = [...existingPicks];
    const cronResults = {};
    let analyzed = 0, failed = 0;

    for (let i = 0; i < schedulable.length; i++) {
      const game = schedulable[i];
      if (i > 0) await new Promise(r => setTimeout(r, 8000));

      try {
        const odds = matchOdds(game, oddsEvents);
        const result = await analyzeGame(game, odds, dateStr);

        // Sanitize PASS
        if (!result.spread?.pickSide || ['pass','PASS'].includes(result.spread.pickSide)) {
          result.spread = { ...result.spread, pickSide: 'away', pick: game.away.name, confidence: 2, edge: 'Low conviction — away +1.5 default value.' };
        }
        if (!result.total?.pick || ['PASS','pass'].includes(result.total.pick)) {
          result.total = { ...result.total, pick: 'UNDER', confidence: 2, edge: 'Low conviction — default under.' };
        }

        cronResults[game.id] = { ...result, analyzedAt: new Date().toISOString() };
        analyzed++;

        // Save picks (upsert — replace pending picks for this game)
        const newPicks = [];
        if (result.spread?.pickSide && result.spread?.pick) {
          newPicks.push({ gameId: String(game.id), gameDate: dateStr, awayTeam: game.away.name, homeTeam: game.home.name, awayAbbrev: game.away.abbrev, homeAbbrev: game.home.abbrev, pickType: 'spread', pick: result.spread.pick, pickSide: result.spread.pickSide, line: result.spread.line, confidence: result.spread.confidence, edge: result.spread.edge, result: 'pending', savedAt: new Date().toISOString() });
        }
        if (result.total?.pick && !['PASS','pass'].includes(result.total.pick)) {
          newPicks.push({ gameId: String(game.id), gameDate: dateStr, awayTeam: game.away.name, homeTeam: game.home.name, awayAbbrev: game.away.abbrev, homeAbbrev: game.home.abbrev, pickType: 'total', pick: result.total.pick, line: result.total.line, confidence: result.total.confidence, edge: result.total.edge, result: 'pending', savedAt: new Date().toISOString() });
        }

        for (const pick of newPicks) {
          const idx = allPicks.findIndex(p => String(p.gameId) === String(game.id) && p.pickType === pick.pickType);
          if (idx >= 0 && allPicks[idx].result === 'pending') {
            allPicks[idx] = pick; // update pending pick with fresh analysis
          } else if (idx === -1) {
            allPicks.push(pick);
          }
        }

      } catch (e) {
        console.error(`Failed: ${game.away.name} @ ${game.home.name}:`, e.message);
        cronResults[game.id] = { error: e.message };
        failed++;
      }
    }

    // Save everything to Redis
    await Promise.all([
      redisSet(PICKS_KEY, allPicks),
      redisSet(CRON_KEY(dateStr), { results: cronResults, analyzedAt: new Date().toISOString(), date: dateStr })
    ]);

    console.log(`Cron done: ${analyzed} analyzed, ${failed} failed`);
    res.status(200).json({ date: dateStr, total: schedulable.length, analyzed, failed });

  } catch (e) {
    console.error('Cron error:', e.message);
    res.status(500).json({ error: e.message });
  }
}
