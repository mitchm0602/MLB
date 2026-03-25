import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    'anthropic-beta': 'interleaved-thinking-2025-05-14'
  }
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { homeTeam, awayTeam, gameDate, spread } = req.body;

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: 'Home and away teams are required' });
  }

  const today = new Date().toISOString().split('T')[0];
  const gameDateStr = gameDate || today;

  const systemPrompt = `You are an elite MLB sports analyst and betting expert specializing in spread analysis. You have deep knowledge of:
- Team statistics (batting average, ERA, WHIP, OPS, wRC+, FIP, xFIP)
- Starting pitcher analysis and recent form
- Bullpen strength and usage patterns
- Injury reports and their impact on lineups
- Home/away splits and ballpark factors
- Head-to-head matchup history
- Weather conditions and their effect on scoring
- Recent team momentum and streaks
- Lineup construction and platoon advantages
- Advanced metrics like expected runs and run differential

You MUST search the web for current, up-to-date information including:
1. Today's injury reports and lineup updates
2. Starting pitcher confirmed starters and recent outings
3. Current team statistics and standings
4. Recent head-to-head results
5. Any relevant news that could affect the game outcome

After gathering all information, provide a comprehensive betting analysis in the following JSON format ONLY (no markdown, no preamble):
{
  "recommendation": "COVER" | "NO COVER" | "LEAN COVER" | "LEAN NO COVER" | "PASS",
  "confidence": <number 1-100>,
  "predictedScore": {
    "home": <number>,
    "away": <number>
  },
  "spreadAnalysis": "<2-3 sentence analysis of the spread>",
  "keyFactors": [
    {"factor": "<factor name>", "impact": "positive" | "negative" | "neutral", "detail": "<explanation>"},
    ...
  ],
  "pitcherMatchup": {
    "home": {"name": "<name>", "era": "<era>", "recentForm": "<summary>"},
    "away": {"name": "<name>", "era": "<era>", "recentForm": "<summary>"}
  },
  "injuries": [
    {"team": "<team>", "player": "<name>", "position": "<pos>", "status": "<status>", "impact": "high" | "medium" | "low"},
    ...
  ],
  "teamStats": {
    "home": {"record": "<W-L>", "lastTen": "<W-L>", "runsPerGame": "<avg>", "era": "<era>"},
    "away": {"record": "<W-L>", "lastTen": "<W-L>", "runsPerGame": "<avg>", "era": "<era>"}
  },
  "weatherImpact": "<weather and ballpark notes>",
  "valueRating": <number 1-10>,
  "summary": "<2-3 sentence executive summary of the pick>",
  "dataTimestamp": "<current date/time of data>"
}`;

  const userMessage = `Analyze the MLB matchup: ${awayTeam} @ ${homeTeam} on ${gameDateStr}.
${spread ? `The spread is: ${homeTeam} ${spread}` : 'No spread provided - analyze the matchup generally.'}

Search for the latest injury reports, confirmed starting pitchers, recent team performance, and any breaking news about these teams. Then provide your complete betting analysis.`;

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      thinking: {
        type: 'enabled',
        budget_tokens: 2000
      },
      tools: [
        {
          type: 'web_search_20250305',
          name: 'web_search'
        }
      ],
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    });

    let fullText = '';
    let searchQueries = [];

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block?.type === 'tool_use' && event.content_block?.name === 'web_search') {
          const query = event.content_block?.input?.query || 'Searching...';
          searchQueries.push(query);
          res.write(`data: ${JSON.stringify({ type: 'search', query })}\n\n`);
        }
      }
      if (event.type === 'content_block_delta') {
        if (event.delta?.type === 'text_delta') {
          fullText += event.delta.text;
          res.write(`data: ${JSON.stringify({ type: 'text', text: event.delta.text })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', searches: searchQueries.length })}\n\n`);
    res.end();

  } catch (error) {
    console.error('API Error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`);
      res.end();
    }
  }
}
