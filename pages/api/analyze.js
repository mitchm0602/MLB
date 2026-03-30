import Anthropic from '@anthropic-ai/sdk';

const SYSTEM_PROMPT = `You are a sharp MLB betting analyst covering the 2026 MLB regular season. You MUST make a pick on EVERY game — both a spread pick and a total pick. Never output "PASS". If low conviction, pick the better value side with confidence 1-3.

STEP 1 — SEARCH FOR LIVE DATA. Before analyzing, you MUST search for:
1. Confirmed starting pitchers for this specific game (search: "[Team1] vs [Team2] starting pitcher [date]")
2. Injury report and lineup updates for both teams (search: "[Team] injury report today" and "[Team] lineup today")
3. Current 2026 season stats — team ERA, runs per game, recent form last 7-10 games (search: "[Team] 2026 stats" or "[Team] season stats 2026")
4. Weather and wind at the ballpark for this game (search: "[City] weather [date] game")

Only after gathering live data should you make your picks.

CRITICAL DATA RULES:
- Use ONLY 2026 regular season data. The season started late March 2026.
- NEVER use spring training stats, spring training records, or 2025 stats.
- If a starter is listed as TBD or unconfirmed, note that and adjust confidence down.
- Actual confirmed lineups and injuries are the most important factors.

CONFIDENCE SCALE:
- 8-10: Strong edge, high conviction — clear matchup advantage confirmed by current data
- 6-7: Solid lean — current data supports this side
- 4-5: Slight edge — lean based on available info
- 1-3: Low conviction — picking better value side but limited data

BETTING PHILOSOPHY:
- The public bets favorites and overs. Sharp money finds value elsewhere.
- Big-market teams (Yankees, Dodgers, Red Sox, Cubs) lines are often inflated. Look for value against them.
- Road underdogs +1.5 cover over 50% historically. Always evaluate the +1.5 side seriously.
- A -1.5 favorite needs a dominant confirmed starter + healthy lineup + weak opposing offense to be worth backing.
- For totals: confirmed starter ERA matters, but park factors and wind direction are equally important.
- Unders are historically profitable — only go over if there are specific reasons (wind out, shaky bullpens, both lineups hot).

Return ONLY valid JSON after your research, no markdown, no backticks:
{"spread":{"pick":"FULL TEAM NAME","pickSide":"away or home","line":"-1.5 or +1.5","confidence":7,"edge":"Specific reason citing LIVE data found via search."},"total":{"pick":"OVER or UNDER","line":8.5,"confidence":6,"predictedRuns":7.2,"edge":"Specific reason citing pitcher, park, weather data."},"predictedScore":{"away":4,"home":3},"pitchers":{"away":{"name":"Confirmed name or TBD","era":"2026 ERA","note":"Recent 2026 form — last 2-3 starts."},"home":{"name":"Confirmed name or TBD","era":"2026 ERA","note":"Recent 2026 form — last 2-3 starts."}},"keyInjuries":[{"team":"away or home","player":"Name","status":"IL10/GTD/OUT","impact":"high or medium or low"}],"topFactors":[{"label":"Short label","detail":"One sentence with specific current data.","side":"away or home or over or under or neutral"}],"teamStats":{"away":{"record":"W-L 2026","last10":"W-L","rpg":"runs/game 2026","era":"team ERA 2026","ops":"OPS 2026"},"home":{"record":"W-L 2026","last10":"W-L","rpg":"runs/game 2026","era":"team ERA 2026","ops":"OPS 2026"}},"weather":"Ballpark name, temp, wind speed and direction (in/out/cross).","summary":"2 sharp sentences explaining the value angle based on live data found."}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];
  const today = new Date();
  const todayStr = today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  const spreadInfo = homeSpread != null
    ? `Spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread} / ${awayTeam} ${homeSpread >= 0 ? '-' : '+'}${Math.abs(homeSpread)}`
    : 'Spread line not available';
  const totalInfo = total != null ? `O/U total: ${total}` : 'Total not available';

  const userMessage = `TODAY IS ${todayStr}. The 2026 MLB regular season is underway. Use ONLY 2026 regular season data.

Search for the latest data on this game, then make your picks:
${awayTeam} (away) @ ${homeTeam} (home) — ${dateStr}
${spreadInfo}
${totalInfo}

Search for: confirmed starters, today's injury reports, current 2026 team stats, weather at the ballpark.
You MUST pick both spread and total. No PASS. Low conviction = confidence 1-3. Return JSON only.`;

  try {
    // Use sonnet with web search for live data
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' }
    });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Collect text from all content blocks
    let fullText = '';
    const searches = [];
    for (const block of (message.content || [])) {
      if (block.type === 'text') fullText += block.text;
      if (block.type === 'server_tool_use' && block.name === 'web_search') {
        searches.push(block.input?.query || '');
      }
    }

    fullText = fullText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const match = fullText.match(/\{[\s\S]*\}/);

    if (!match) {
      console.error('No JSON found. Searches:', searches, 'Raw:', fullText.slice(0, 300));
      return res.status(500).json({ error: 'No JSON in response', searches, raw: fullText.slice(0, 200) });
    }

    const result = JSON.parse(match[0]);

    // Sanitize: if model still returned PASS despite instructions, convert to low confidence pick
    if (!result.spread?.pickSide || ['pass', 'PASS'].includes(result.spread.pickSide)) {
      result.spread = { ...result.spread, pickSide: 'away', pick: awayTeam, confidence: 2, edge: 'Low conviction — away +1.5 as default value.' };
    }
    if (!result.total?.pick || ['PASS', 'pass'].includes(result.total.pick)) {
      result.total = { ...result.total, pick: 'UNDER', confidence: 2, edge: 'Low conviction — defaulting under.' };
    }

    res.status(200).json({ ...result, searches, analyzedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Analyze error:', error.status, error.message);

    // If sonnet/web search fails, fall back to haiku without search
    try {
      const fallbackClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const fallback = await fallbackClient.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }]
      });
      const fallbackText = (fallback.content?.[0]?.text || '').replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const fallbackMatch = fallbackText.match(/\{[\s\S]*\}/);
      if (!fallbackMatch) return res.status(500).json({ error: 'No JSON in fallback response' });
      const fallbackResult = JSON.parse(fallbackMatch[0]);
      if (!fallbackResult.spread?.pickSide || ['pass','PASS'].includes(fallbackResult.spread.pickSide)) {
        fallbackResult.spread = { ...fallbackResult.spread, pickSide: 'away', pick: awayTeam, confidence: 2, edge: 'Low conviction fallback.' };
      }
      if (!fallbackResult.total?.pick || ['PASS','pass'].includes(fallbackResult.total.pick)) {
        fallbackResult.total = { ...fallbackResult.total, pick: 'UNDER', confidence: 2, edge: 'Low conviction fallback.' };
      }
      return res.status(200).json({ ...fallbackResult, fallback: true, analyzedAt: new Date().toISOString() });
    } catch (fallbackErr) {
      return res.status(500).json({ error: error.message, fallbackError: fallbackErr.message });
    }
  }
}
