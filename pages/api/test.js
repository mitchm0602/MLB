import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  const results = {};

  // Step 1: Check API key exists
  results.keyExists = !!process.env.ANTHROPIC_API_KEY;
  results.keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 12) || 'NOT SET';

  if (!results.keyExists) {
    return res.status(200).json(results);
  }

  // Step 2: Try simplest possible API call
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say OK' }]
    });
    results.basicCall = 'success';
    results.response = msg.content?.[0]?.text;
    results.model = 'claude-haiku-4-5';
  } catch (e) {
    results.basicCall = 'failed';
    results.basicError = e.message;
    results.basicStatus = e.status;
    return res.status(200).json(results);
  }

  // Step 3: Try sonnet-4-6
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 20,
      messages: [{ role: 'user', content: 'Say OK' }]
    });
    results.sonnetCall = 'success';
    results.sonnetResponse = msg.content?.[0]?.text;
  } catch (e) {
    results.sonnetCall = 'failed';
    results.sonnetError = e.message;
    results.sonnetStatus = e.status;
  }

  // Step 4: Try a minimal analyze-style call
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 200,
      messages: [{ role: 'user', content: 'Return this exact JSON: {"spread":{"pick":"Yankees","confidence":7},"total":{"pick":"UNDER","confidence":6}}' }]
    });
    const text = msg.content?.[0]?.text || '';
    results.analyzeStyleCall = 'success';
    results.analyzeRaw = text.slice(0, 300);
    const match = text.match(/\{[\s\S]*\}/);
    results.jsonParsed = match ? 'yes' : 'no';
  } catch (e) {
    results.analyzeStyleCall = 'failed';
    results.analyzeError = e.message;
    results.analyzeStatus = e.status;
  }

  res.status(200).json(results);
}
