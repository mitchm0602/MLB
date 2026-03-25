import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an MLB betting analyst. Return ONLY valid JSON, nothing else. No markdown, no backticks, no explanation.

Use this exact structure:
{"spread":{"pick":"FULL TEAM NAME","pickSide":"away or home or pass","line":"-1.5","confidence":7,"edge":"One sentence why."},"total":{"pick":"OVER or UNDER or PASS","line":7.0,"confidence":6,"predictedRuns":6.5,"edge":"One sentence why."},"predictedScore":{"away":3,"home":2},"pitchers":{"away":{"name":"Name or TBD","era":"3.45","note":"Brief note."},"home":{"name":"Name or TBD","era":"2.98","note":"Brief note."}},"keyInjuries":[{"team":"away or home","player":"Name","status":"IL10","impact":"high"}],"topFactors":[{"label":"Short label","detail":"One sentence.","side":"home"}],"teamStats":{"away":{"record":"15-10","last10":"7-3","rpg":"4.8","era":"3.92","ops":".742"},"home":{"record":"12-13","last10":"5-5","rpg":"4.1","era":"4.21","ops":".718"}},"weather":"Brief note.","summary":"2 sentence take."}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { homeTeam, awayTeam, gameDate, homeSpread, total } = req.body;
  if (!homeTeam || !awayTeam) return res.status(400).json({ error: 'Teams required' });

  const dateStr = gameDate || new Date().toISOString().split('T')[0];
  const lines = [
    homeSpread != null ? `Spread: ${homeTeam} ${homeSpread > 0 ? '+' : ''}${homeSpread}` : '',
    total != null ? `O/U: ${total}` : ''
  ].filter(Boolean).join(', ');

  const userMessage = `${awayTeam} @ ${homeTeam}, ${dateStr}. ${lines}. Analyze for betting. Return JSON only.`;

  try {
    const message = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
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
