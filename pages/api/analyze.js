import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an MLB betting analyst. Analyze the game and return ONLY valid JSON — no markdown, no backticks, nothing else.

JSON format:
{"spread":{"pick":"TEAM NAME","pickSide":"away|home|pass","line":"-1.5","confidence":7,"edge":"Why this side covers in one sentence."},"total":{"pick":"OVER|UNDER|PASS","line":7.0,"confidence":6,"predictedRuns":6.5,"edge":"Why in one sentence."},"predictedScore":{"away":3,"home":2},"pitchers":{"away":{"name":"Name","era":"3.45","note":"Recent form."},"home":{"name":"Name","era":"2.98","note":"Recent form."}},"keyInjuries":[{"team":"away|home","player":"Name","status":"IL10","impact":"high|medium|low"}],"topFactors":[{"label":"Label","detail":"One sentence.","side":"home|away|over|under|neutral"}],"teamStats":{"away":{"record":"15-10","last10":"7-3","rpg":"4.8","era":"3.92","ops":".742"},"home":{"record":"12-13","last10":"5-5","rpg":"4.1","era":"4.21","ops":".718"}},"weather":"Brief weather and ballpark note.","summary":"2-3 sentence analyst take."}`;

async function callClaude(userMessage, withSearch) {
  const options = {
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  };

  if (withSearch) {
    options.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    return new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: { 'anthropic-beta': 'web-search-2025-03-05' }
    }).messages.create(options);
  }

  return client.messages.create(options);
}

function extractResult(message) {
  let fullText = '';
  const searches = [];
  for (const block of (message.content || [])) {
    if (block.type === 'text') fullText += block.text;
    if (block.type === 'server_tool_use' && block.name === 'web_search') searches.push(block.input?.query || '');
  }
  fullText = fullText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const match = fullText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in response');
  return { ...JSON.parse(match[0]), searches };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];
  const lines = [
    homeSpread != null ? `Spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread}` : '',
    total != null ? `O/U: ${total}` : ''
  ].filter(Boolean).join(', ');

  const userMessage = `MLB game: ${awayTeam} @ ${homeTeam} on ${dateStr}. ${lines}. Analyze and return JSON only.`;

  try {
    let message;
    try {
      message = await callClaude(userMessage, true);
    } catch (e) {
      if (e.status === 429) throw e; // don't retry on rate limit
      message = await callClaude(userMessage, false);
    }
    const result = extractResult(message);
    res.status(200).json({ ...result, analyzedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Analyze error:', error.status, error.message);
    res.status(500).json({ error: error.message, httpStatus: error.status });
  }
}
