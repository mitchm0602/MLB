import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an elite MLB betting analyst. For every game you analyze, you MUST search the web to find current data before making predictions. Search for:
1. Confirmed starting pitchers and their recent stats (last 3 starts, ERA, WHIP, strikeout rate)
2. Full injury and IL reports for both teams
3. Current season team stats (runs per game, team ERA, bullpen ERA, batting average, OPS)
4. Win/loss records, last 10 games, home/away splits
5. Head-to-head history this season
6. Lineup news, day-of scratches, weather forecast for the ballpark
7. Ballpark factors (run-friendly or pitcher-friendly)
8. Any other relevant news (slumps, hot streaks, roster moves)

After thorough research, return ONLY a JSON object with NO markdown, NO backticks, NO preamble:
{
  "spread": {
    "pick": "<AWAY TEAM NAME> | <HOME TEAM NAME> | PASS",
    "pickSide": "away | home | pass",
    "line": "<the spread line, e.g. -1.5>",
    "confidence": <0-10>,
    "edge": "<1-2 sentences on WHY this side covers>"
  },
  "total": {
    "pick": "OVER | UNDER | PASS",
    "line": <the O/U number as a float>,
    "confidence": <0-10>,
    "predictedRuns": <your predicted total runs as a float>,
    "edge": "<1-2 sentences on WHY over or under>"
  },
  "predictedScore": { "away": <int>, "home": <int> },
  "pitchers": {
    "away": { "name": "<name or TBD>", "era": "<ERA>", "note": "<brief form note>" },
    "home": { "name": "<name or TBD>", "era": "<ERA>", "note": "<brief form note>" }
  },
  "keyInjuries": [
    { "team": "away | home", "player": "<name>", "status": "<IL/GTD/OUT>", "impact": "high | medium | low" }
  ],
  "topFactors": [
    { "label": "<short label>", "detail": "<one sentence>", "side": "away | home | over | under | neutral" }
  ],
  "teamStats": {
    "away": { "record": "<W-L>", "last10": "<W-L>", "rpg": "<runs/game>", "era": "<team ERA>", "ops": "<OPS>" },
    "home": { "record": "<W-L>", "last10": "<W-L>", "rpg": "<runs/game>", "era": "<team ERA>", "ops": "<OPS>" }
  },
  "weather": "<weather + ballpark factor note>",
  "summary": "<3-4 sentence sharp analyst take on this game>"
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];
  const spreadInfo = homeSpread != null ? `The current spread has ${homeTeam} at ${homeSpread > 0 ? '+' : ''}${homeSpread}. ` : '';
  const totalInfo = total != null ? `The O/U total is ${total}. ` : '';

  const userMessage = `Analyze: ${awayTeam} @ ${homeTeam} on ${dateStr}.
${spreadInfo}${totalInfo}
Search thoroughly for current injury reports, confirmed starters, recent form, stats, and weather. Then give your complete betting analysis JSON.`;

  try {
    // Use streaming internally but collect full response before returning
    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    let fullText = '';
    const searches = [];

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'tool_use' && event.content_block?.name === 'web_search') {
          searches.push(event.content_block?.input?.query || '');
        }
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text;
      }
    }

    // Extract JSON
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const result = JSON.parse(jsonMatch[0]);

    res.status(200).json({ ...result, searches, analyzedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Analyze error:', error.message);
    res.status(500).json({ error: error.message });
  }
}
