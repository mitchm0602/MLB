import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an elite MLB betting analyst. For every game you analyze, you MUST use the web_search tool to find current data. Run at least 4 searches covering:
1. Starting pitchers confirmed + recent stats for both teams
2. Injury and IL reports for both teams  
3. Current season team stats, records, last 10 games
4. Recent news, lineup updates, weather forecast

After researching, return ONLY a raw JSON object. No markdown. No backticks. No text before or after. Start your response with { and end with }.

Required format:
{
  "spread": {
    "pick": "AWAY_TEAM_NAME or HOME_TEAM_NAME or PASS",
    "pickSide": "away or home or pass",
    "line": "-1.5 or +1.5 etc",
    "confidence": 7,
    "edge": "One or two sentences explaining why."
  },
  "total": {
    "pick": "OVER or UNDER or PASS",
    "line": 8.5,
    "confidence": 6,
    "predictedRuns": 9.2,
    "edge": "One or two sentences explaining why."
  },
  "predictedScore": { "away": 4, "home": 3 },
  "pitchers": {
    "away": { "name": "Pitcher Name", "era": "3.45", "note": "Brief recent form." },
    "home": { "name": "Pitcher Name", "era": "2.98", "note": "Brief recent form." }
  },
  "keyInjuries": [
    { "team": "away", "player": "Player Name", "status": "IL10", "impact": "high" }
  ],
  "topFactors": [
    { "label": "Factor Label", "detail": "One sentence detail.", "side": "home" }
  ],
  "teamStats": {
    "away": { "record": "15-10", "last10": "7-3", "rpg": "4.8", "era": "3.92", "ops": ".742" },
    "home": { "record": "12-13", "last10": "5-5", "rpg": "4.1", "era": "4.21", "ops": ".718" }
  },
  "weather": "Clear, 72F, wind 8mph out to center. Hitter-friendly conditions.",
  "summary": "3-4 sentence sharp analyst take on this game."
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];
  const spreadInfo = homeSpread != null ? `The current spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread}.` : 'No spread available.';
  const totalInfo = total != null ? `The O/U total: ${total}.` : 'No total available.';

  const userMessage = `Analyze this MLB game: ${awayTeam} (away) @ ${homeTeam} (home) on ${dateStr}.
${spreadInfo} ${totalInfo}
Search for current injuries, confirmed starters, team stats, and recent form. Return only the JSON.`;

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });

    // Collect all text blocks from response
    let fullText = '';
    const searches = [];

    for (const block of message.content) {
      if (block.type === 'text') fullText += block.text;
      if (block.type === 'tool_use' && block.name === 'web_search') {
        searches.push(block.input?.query || '');
      }
    }

    // Strip any markdown fences just in case
    fullText = fullText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

    // Extract JSON object
    const jsonMatch = fullText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('No JSON found. Raw response:', fullText.slice(0, 500));
      return res.status(500).json({ error: 'No JSON in response', raw: fullText.slice(0, 300) });
    }

    let result;
    try {
      result = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr.message, jsonMatch[0].slice(0, 300));
      return res.status(500).json({ error: 'JSON parse failed: ' + parseErr.message });
    }

    res.status(200).json({ ...result, searches, analyzedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Analyze API error:', error.message, error.status, error.error);
    res.status(500).json({
      error: error.message,
      status: error.status,
      detail: error.error?.error?.message || ''
    });
  }
}
