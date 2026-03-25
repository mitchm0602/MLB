# ⚾ MLB Edge — AI Spread Analyzer

An AI-powered MLB betting tool that uses Claude with live web search to analyze matchups vs. the spread. Gets real-time injury reports, starting pitchers, team stats, weather, and more.

## Features

- **Live Data**: Claude searches the web in real-time for current injury reports, lineups, and stats
- **Spread Analysis**: Input any spread and get a COVER / NO COVER recommendation with confidence %
- **Pitcher Matchup**: Confirmed starters with ERA and recent form
- **Injury Report**: Impact-rated injury data from both teams
- **Team Stats**: Live W-L record, last-10, runs per game, ERA
- **Key Factors**: Prioritized list of what's driving the pick
- **Predicted Score**: AI-projected final score
- **Weather & Ballpark**: Environmental factors affecting scoring
- **Analysis History**: Last 10 analyses saved in session

## Tech Stack

- **Next.js 14** (Pages Router)
- **Anthropic Claude** with web search + extended thinking
- **Deployed on Vercel**

---

## Local Development

### 1. Install dependencies
```bash
npm install
```

### 2. Set up environment
```bash
cp .env.local.example .env.local
```
Edit `.env.local` and add your Anthropic API key from https://console.anthropic.com

### 3. Run dev server
```bash
npm run dev
```
Open http://localhost:3000

---

## Deploy to Vercel

### Option A: Vercel CLI (recommended)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy (follow prompts)
vercel

# Set your API key
vercel env add ANTHROPIC_API_KEY
# Paste your key when prompted

# Deploy to production
vercel --prod
```

### Option B: GitHub + Vercel Dashboard

1. Push this repo to GitHub
2. Go to https://vercel.com/new
3. Import your GitHub repo
4. In **Environment Variables**, add:
   - Name: `ANTHROPIC_API_KEY`
   - Value: your key from https://console.anthropic.com
5. Click **Deploy**

---

## Environment Variables

| Variable | Description | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key | ✅ Yes |

---

## How It Works

1. User selects home/away teams, date, and spread
2. App calls `/api/analyze` which calls Claude Sonnet 4
3. Claude uses **web search** to find live injury reports, starting pitchers, recent stats, and news
4. Claude uses **extended thinking** to reason through the matchup deeply
5. Claude returns structured JSON with recommendation, confidence, and full analysis
6. Frontend renders the analysis in a clean dashboard

## API Route

`POST /api/analyze`

Request:
```json
{
  "homeTeam": "New York Yankees",
  "awayTeam": "Boston Red Sox",
  "spread": "-1.5",
  "gameDate": "2025-04-15"
}
```

Response: Server-sent events stream with search queries and final JSON analysis.

---

## Responsible Gambling

This tool is for **entertainment purposes only**. Sports betting involves financial risk. Always gamble responsibly. Must be 21+ where applicable. If you have a gambling problem, call 1-800-522-4700.

---

## License

MIT
