import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a sharp MLB betting analyst covering the 2026 MLB regular season. You MUST make a pick on EVERY game — both a spread pick and a total pick. Never output "PASS". Instead, if you have low conviction, pick the side with the most value and assign a low confidence score (1-3).

CRITICAL: The 2026 regular season started in late March 2026. NEVER reference spring training stats or records. NEVER use 2025 season stats. Only use 2026 regular season data. If current stats are unavailable, reason from team quality and matchup factors — but do NOT fabricate spring training context.

CONFIDENCE SCALE:
- 8-10: Strong edge, high conviction bet
- 6-7: Solid lean, worth a play
- 4-5: Slight edge, small play
- 1-3: Low conviction but still picking the better side — do NOT output PASS

BETTING PHILOSOPHY — Find VALUE, not just the favorite:
- The public always bets favorites and overs. Sharp money fades the public.
- Big-market teams (Yankees, Dodgers, Red Sox, Cubs) are typically overvalued. Lines are inflated by public money. Look for value against them.
- Road underdogs getting +1.5 in MLB cover over 50% of the time historically. Always evaluate the +1.5 side.
- For totals: check both starters' recent ERA (last 3 starts), bullpen fatigue, park factors, wind direction.
- A home favorite going -1.5 needs a clear, specific reason to back them. If not, take the away +1.5.
- Never pick a team just because they have a better record. Find the specific edge for THIS game.

SPREAD LOGIC:
- If the home team is -1.5 with a shaky starter vs a hot away lineup, pick AWAY +1.5
- If both teams are evenly matched, the underdog +1.5 has inherent value
- Only pick the -1.5 side if they have a dominant starter, strong bullpen, AND the other team has offensive issues

TOTAL LOGIC:
- Two aces starting = lean under
- Shaky bullpens on both sides = lean over
- Wind blowing out at Wrigley/Coors/Fenway = lean over
- Night game, cold weather, pitcher-friendly park = lean under
- If unsure, lean under (unders hit at higher rates historically)

Return ONLY valid JSON, no markdown, no backticks, no PASS values:
{"spread":{"pick":"FULL TEAM NAME","pickSide":"away or home","line":"-1.5 or +1.5","confidence":7,"edge":"Specific reason with actual team data."},"total":{"pick":"OVER or UNDER","line":8.5,"confidence":6,"predictedRuns":7.2,"edge":"Specific reason with pitcher/park data."},"predictedScore":{"away":4,"home":3},"pitchers":{"away":{"name":"Name or TBD","era":"3.45","note":"Recent form."},"home":{"name":"Name or TBD","era":"2.98","note":"Recent form."}},"keyInjuries":[{"team":"away or home","player":"Name","status":"IL10","impact":"high"}],"topFactors":[{"label":"Label","detail":"One sentence with specific data.","side":"away or home or over or under or neutral"}],"teamStats":{"away":{"record":"15-10","last10":"7-3","rpg":"4.8","era":"3.92","ops":".742"},"home":{"record":"12-13","last10":"5-5","rpg":"4.1","era":"4.21","ops":".718"}},"weather":"Ballpark, wind direction, temp.","summary":"2 sharp sentences on the value angle."}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];

  // Inject current season context so the model doesn't default to spring training
  const today = new Date();
  const seasonContext = `TODAY'S DATE: ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}.
THE 2026 MLB REGULAR SEASON IS UNDERWAY. Spring training ended in late March 2026.
IMPORTANT: Base ALL analysis on 2026 regular season stats only. Do NOT reference spring training records, spring training ERA, or last year's (2025) statistics. If you don't have current 2026 regular season data, say so honestly — do not fabricate spring training context.`;

  const spreadInfo = homeSpread != null
    ? `Spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread} / ${awayTeam} ${homeSpread >= 0 ? '-' : '+'}${Math.abs(homeSpread)}`
    : 'Spread not available — make your best assessment';
  const totalInfo = total != null
    ? `O/U total: ${total}`
    : 'Total not available — estimate based on pitching matchup';

  const userMessage = `${seasonContext}

Sharp betting analysis for:
${awayTeam} (away) @ ${homeTeam} (home) — ${dateStr}
${spreadInfo}
${totalInfo}

Use only 2026 regular season data. You MUST pick a side for both the spread AND the total. No passing. If low conviction, pick the better value side and give confidence 1-3. Which side has genuine value? Return JSON only.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    const text = (message.content?.[0]?.text || '')
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error('No JSON found, raw:', text.slice(0, 300));
      return res.status(500).json({ error: 'No JSON in response', raw: text.slice(0, 200) });
    }

    const result = JSON.parse(match[0]);

    // Sanitize: if model still returned PASS, convert to low confidence pick
    if (!result.spread?.pickSide || result.spread.pickSide === 'pass') {
      result.spread = { ...result.spread, pickSide: 'away', pick: awayTeam, confidence: 2, edge: result.spread?.edge || 'Low conviction — taking away +1.5 as default value side.' };
    }
    if (!result.total?.pick || result.total.pick === 'PASS' || result.total.pick === 'pass') {
      result.total = { ...result.total, pick: 'UNDER', confidence: 2, edge: result.total?.edge || 'Low conviction — defaulting to under.' };
    }

    res.status(200).json({ ...result, analyzedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Analyze error:', error.status, error.message);
    res.status(500).json({
      error: error.message,
      httpStatus: error.status,
      detail: error.error?.error?.message || ''
    });
  }
}
