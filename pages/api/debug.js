import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req, res) {
  const keyExists = !!process.env.ANTHROPIC_API_KEY;
  const keyPrefix = process.env.ANTHROPIC_API_KEY?.slice(0, 8) || 'NOT SET';

  if (!keyExists) {
    return res.status(200).json({ status: 'error', message: 'ANTHROPIC_API_KEY not set in environment' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // Simple test call - no web search, just verify API key + model work
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'Reply with only the word: OK' }]
    });

    const text = message.content?.[0]?.text || '';
    res.status(200).json({
      status: 'success',
      model: 'claude-sonnet-4-6',
      keyPrefix,
      response: text,
      stopReason: message.stop_reason,
    });
  } catch (error) {
    res.status(200).json({
      status: 'api_error',
      keyPrefix,
      error: error.message,
      httpStatus: error.status,
      detail: error.error?.error?.message || '',
    });
  }
}
