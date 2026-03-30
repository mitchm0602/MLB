import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a sharp MLB betting analyst who finds VALUE, not just picks favorites. Your job is to beat the sportsbook, not pick the obvious side.

CRITICAL BETTING PRINCIPLES:
- The public bets favorites and overs. Sharp money often goes the other way.
- A -1.5 favorite is only worth backing if they have a clear, specific edge. Otherwise the underdog +1.5 has more value.
- Road teams, underdogs, and unders are frequently undervalued.
- PASS is a valid and often correct pick. If there's no clear edge, say PASS.
- Confidence should reflect genuine edge: 8-10 = strong edge, 6-7 = moderate lean, 1-5 = PASS territory.
- Do NOT default to the home team or favorite. Analyze the actual matchup.
- Look for: bullpen mismatches, pitcher ERA vs recent form, lineup injuries, park factors, weather, travel fatigue, streaks, head-to-head.

SPREAD ANALYSIS:
- If the home team is -1.5 but their ace is on a 3-start skid and the away team just swept a series, pick the AWAY team +1.5.
- If a big-market team (Yankees, Dodgers, Red Sox) is favored, assume the line is inflated by public money. Look for value on the other side.
- Consider: does the favorite actually win by 2+ runs consistently? If not, the underdog covers more often.

TOTAL ANALYSIS:
- Check both teams' recent run totals, not season averages.
- Pitcher ERA matters but recent form matters more.
- Wind direction at the ballpark is a major factor (out = overs, in = unders).
- If both bullpens have been shaky lately, lean over. If both starters are aces, lean under.

Return ONLY valid JSON, no markdown, no backticks:
{"spread":{"pick":"FULL TEAM NAME or PASS","pickSide":"away or home or pass","line":"-1.5 or +1.5","confidence":7,"edge":"Specific reason citing actual team data, not generic."},"total":{"pick":"OVER or UNDER or PASS","line":8.5,"confidence":6,"predictedRuns":7.2,"edge":"Specific reason."},"predictedScore":{"away":4,"home":3},"pitchers":{"away":{"name":"Name or TBD","era":"3.45","note":"Recent form note."},"home":{"name":"Name or TBD","era":"2.98","note":"Recent form note."}},"keyInjuries":[{"team":"away or home","player":"Name","status":"IL10","impact":"high"}],"topFactors":[{"label":"Short label","detail":"One sentence with specific data.","side":"away or home or over or under or neutral"}],"teamStats":{"away":{"record":"15-10","last10":"7-3","rpg":"4.8","era":"3.92","ops":".742"},"home":{"record":"12-13","last10":"5-5","rpg":"4.1","era":"4.21","ops":".718"}},"weather":"Ballpark + wind direction + temp.","summary":"2 sharp sentences explaining the value angle, not just who is better."}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];

  const spreadInfo = homeSpread != null
    ? `Spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread} / ${awayTeam} ${homeSpread > 0 ? '-' : '+'}${Math.abs(homeSpread)}`
    : 'No spread line available';
  const totalInfo = total != null ? `O/U total: ${total}` : 'No total available';

  const userMessage = `Analyze this MLB game for sharp betting value:
${awayTeam} (away) @ ${homeTeam} (home) — ${dateStr}
${spreadInfo}
${totalInfo}

Consider: Which side has genuine VALUE vs the line? Is there a reason to back the underdog or dog side of the total? What specific factors favor each team? If there's no clear edge, pick PASS. Return JSON only.`;

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
