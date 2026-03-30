import { redisGet } from './_redis';

export default async function handler(req, res) {
  const { date } = req.query;
  if (!date) return res.status(400).json({ error: 'date required' });

  try {
    const data = await redisGet(`mlb-cron-analysis-${date}`);
    if (!data) return res.status(404).json({ error: 'No cron analysis found for this date' });
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
