import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an elite MLB betting analyst with deep knowledge of team statistics, pitching matchups, ballpark factors, and betting lines. Analyze each game thoroughly using all available information.

After your analysis, return ONLY a raw JSON object. No markdown. No backticks. No explanation before or after. Your entire response must be valid JSON starting with { and ending with }.

Required format exactly:
{
  "spread": {
    "pick": "New York Yankees",
    "pickSide": "away",
    "line": "-1.5",
    "confidence": 7,
    "edge": "Yankees have superior starting pitching and bullpen depth for this matchup."
  },
  "total": {
    "pick": "UNDER",
    "line": 7.0,
    "confidence": 6,
    "predictedRuns": 6.5,
    "edge": "Two elite starters expected, Oracle Park suppresses offense."
  },
  "predictedScore": { "away": 3, "home": 2 },
  "pitchers": {
    "away": { "name": "Pitcher Name or TBD", "era": "3.45", "note": "Brief note on recent form." },
    "home": { "name": "Pitcher Name or TBD", "era": "2.98", "note": "Brief note on recent form." }
  },
  "keyInjuries": [
    { "team": "away", "player": "Player Name", "status": "IL10", "impact": "high" }
  ],
  "topFactors": [
    { "label": "Short Label", "detail": "One sentence explanation.", "side": "home" }
  ],
  "teamStats": {
    "away": { "record": "15-10", "last10": "7-3", "rpg": "4.8", "era": "3.92", "ops": ".742" },
    "home": { "record": "12-13", "last10": "5-5", "rpg": "4.1", "era": "4.21", "ops": ".718" }
  },
  "weather": "Clear, 72F, wind 8mph out to center. Neutral conditions.",
  "summary": "3-4 sentence sharp analyst take covering pitching matchup, lineup edge, and the bet."
}`;

async function analyzeWithSearch(userMessage) {
  // Try with web search first (requires beta header)
  const clientWithSearch = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' }
  });

  const message = await clientWithSearch.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });

  return message;
}

async function analyzeWithoutSearch(userMessage) {
  // Fallback: no web search tool, uses training knowledge
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });

  return message;
}

function extractResult(message) {
  let fullText = '';
  const searches = [];

  for (const block of (message.content || [])) {
    if (block.type === 'text') fullText += block.text;
    if (block.type === 'tool_use' && block.name === 'web_search') {
      searches.push(block.input?.query || '');
    }
    // web search results are server_tool_use blocks
    if (block.type === 'server_tool_use' && block.name === 'web_search') {
      searches.push(block.input?.query || '');
    }
  }

  fullText = fullText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  const jsonMatch = fullText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response. Got: ' + fullText.slice(0, 200));

  const result = JSON.parse(jsonMatch[0]);
  return { ...result, searches, usedSearch: searches.length > 0 };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];
  const spreadInfo = homeSpread != null ? `Current spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread}.` : 'No spread line available.';
  const totalInfo = total != null ? `O/U total: ${total}.` : 'No total line available.';

  const userMessage = `Analyze this MLB game for betting: ${awayTeam} (away) @ ${homeTeam} (home) on ${dateStr}.
${spreadInfo} ${totalInfo}
Consider starting pitchers, recent team form, injuries, bullpen, ballpark factors, and head-to-head history. Return only the JSON.`;

  try {
    let message;
    let usedSearch = false;

    // Try web search first, fall back to knowledge-only if it fails
    try {
      message = await analyzeWithSearch(userMessage);
      usedSearch = true;
    } catch (searchErr) {
      console.log('Web search failed, falling back:', searchErr.message);
      message = await analyzeWithoutSearch(userMessage);
    }

    const result = extractResult(message);
    res.status(200).json({ ...result, analyzedAt: new Date().toISOString() });

  } catch (error) {
    console.error('Analyze error:', error.message, error.status);
    res.status(500).json({
      error: error.message,
      httpStatus: error.status,
      detail: error.error?.error?.message || ''
    });
  }
}
