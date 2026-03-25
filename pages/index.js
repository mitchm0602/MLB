import { useState, useRef } from 'react';
import Head from 'next/head';
import styles from '../styles/Home.module.css';

const MLB_TEAMS = [
  'Arizona Diamondbacks', 'Atlanta Braves', 'Baltimore Orioles', 'Boston Red Sox',
  'Chicago Cubs', 'Chicago White Sox', 'Cincinnati Reds', 'Cleveland Guardians',
  'Colorado Rockies', 'Detroit Tigers', 'Houston Astros', 'Kansas City Royals',
  'Los Angeles Angels', 'Los Angeles Dodgers', 'Miami Marlins', 'Milwaukee Brewers',
  'Minnesota Twins', 'New York Mets', 'New York Yankees', 'Oakland Athletics',
  'Philadelphia Phillies', 'Pittsburgh Pirates', 'San Diego Padres', 'San Francisco Giants',
  'Seattle Mariners', 'St. Louis Cardinals', 'Tampa Bay Rays', 'Texas Rangers',
  'Toronto Blue Jays', 'Washington Nationals'
];

const TEAM_ABBREV = {
  'Arizona Diamondbacks': 'ARI', 'Atlanta Braves': 'ATL', 'Baltimore Orioles': 'BAL',
  'Boston Red Sox': 'BOS', 'Chicago Cubs': 'CHC', 'Chicago White Sox': 'CWS',
  'Cincinnati Reds': 'CIN', 'Cleveland Guardians': 'CLE', 'Colorado Rockies': 'COL',
  'Detroit Tigers': 'DET', 'Houston Astros': 'HOU', 'Kansas City Royals': 'KC',
  'Los Angeles Angels': 'LAA', 'Los Angeles Dodgers': 'LAD', 'Miami Marlins': 'MIA',
  'Milwaukee Brewers': 'MIL', 'Minnesota Twins': 'MIN', 'New York Mets': 'NYM',
  'New York Yankees': 'NYY', 'Oakland Athletics': 'OAK', 'Philadelphia Phillies': 'PHI',
  'Pittsburgh Pirates': 'PIT', 'San Diego Padres': 'SD', 'San Francisco Giants': 'SF',
  'Seattle Mariners': 'SEA', 'St. Louis Cardinals': 'STL', 'Tampa Bay Rays': 'TB',
  'Texas Rangers': 'TEX', 'Toronto Blue Jays': 'TOR', 'Washington Nationals': 'WSH'
};

export default function Home() {
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [spread, setSpread] = useState('');
  const [gameDate, setGameDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [searches, setSearches] = useState([]);
  const [rawText, setRawText] = useState('');
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const abortRef = useRef(null);

  const handleAnalyze = async () => {
    if (!homeTeam || !awayTeam) {
      setError('Please select both teams');
      return;
    }
    if (homeTeam === awayTeam) {
      setError('Home and away teams must be different');
      return;
    }

    setLoading(true);
    setResult(null);
    setSearches([]);
    setRawText('');
    setError('');

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeTeam, awayTeam, spread, gameDate })
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Analysis failed');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'search') {
              setSearches(prev => [...prev, data.query]);
            } else if (data.type === 'text') {
              accumulated += data.text;
              setRawText(accumulated);
            } else if (data.type === 'done') {
              const jsonMatch = accumulated.match(/\{[\s\S]*\}/);
              if (jsonMatch) {
                try {
                  const parsed = JSON.parse(jsonMatch[0]);
                  setResult(parsed);
                  setHistory(prev => [{
                    id: Date.now(),
                    homeTeam, awayTeam, spread, gameDate,
                    result: parsed
                  }, ...prev.slice(0, 9)]);
                } catch (e) {
                  setError('Could not parse analysis. Raw response shown below.');
                }
              }
            } else if (data.type === 'error') {
              setError(data.error);
            }
          } catch (e) { /* skip malformed */ }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const getRecommendationColor = (rec) => {
    if (!rec) return '';
    if (rec.includes('COVER') && !rec.includes('NO')) return styles.green;
    if (rec.includes('NO COVER')) return styles.red;
    if (rec.includes('LEAN')) return styles.amber;
    return styles.muted;
  };

  const getConfidenceBar = (conf) => {
    const pct = conf || 0;
    let color = '#4adbf9';
    if (pct >= 70) color = '#4afa9a';
    else if (pct >= 55) color = '#e8f94a';
    else if (pct < 45) color = '#ff4d4d';
    return { width: `${pct}%`, background: color };
  };

  return (
    <>
      <Head>
        <title>MLB Edge — AI Spread Analyzer</title>
        <meta name="description" content="AI-powered MLB betting analysis with live injury data" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚾</text></svg>" />
      </Head>

      <div className={styles.app}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.logo}>
              <span className={styles.logoIcon}>⚾</span>
              <div>
                <div className={styles.logoTitle}>MLB EDGE</div>
                <div className={styles.logoSub}>AI Spread Analyzer</div>
              </div>
            </div>
            <div className={styles.headerBadge}>
              <span className={styles.liveDot}></span>
              LIVE DATA
            </div>
          </div>
        </header>

        <main className={styles.main}>
          {/* Input Panel */}
          <section className={styles.inputPanel}>
            <div className={styles.panelLabel}>MATCHUP SETUP</div>

            <div className={styles.teamsRow}>
              <div className={styles.teamSelect}>
                <label>AWAY TEAM</label>
                <select value={awayTeam} onChange={e => setAwayTeam(e.target.value)}>
                  <option value="">Select team...</option>
                  {MLB_TEAMS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className={styles.atSymbol}>@</div>

              <div className={styles.teamSelect}>
                <label>HOME TEAM</label>
                <select value={homeTeam} onChange={e => setHomeTeam(e.target.value)}>
                  <option value="">Select team...</option>
                  {MLB_TEAMS.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className={styles.secondRow}>
              <div className={styles.inputGroup}>
                <label>GAME DATE</label>
                <input
                  type="date"
                  value={gameDate}
                  onChange={e => setGameDate(e.target.value)}
                />
              </div>
              <div className={styles.inputGroup}>
                <label>SPREAD (e.g. -1.5)</label>
                <input
                  type="text"
                  placeholder="e.g. -1.5"
                  value={spread}
                  onChange={e => setSpread(e.target.value)}
                />
              </div>
              <button
                className={styles.analyzeBtn}
                onClick={handleAnalyze}
                disabled={loading}
              >
                {loading ? <><span className={styles.btnLoader}></span> ANALYZING</> : '⚡ ANALYZE'}
              </button>
            </div>

            {error && <div className={styles.errorBar}>{error}</div>}
          </section>

          {/* Live Search Feed */}
          {(loading || searches.length > 0) && (
            <section className={styles.searchFeed}>
              <div className={styles.panelLabel}>
                {loading ? <><span className={styles.loader}></span> LIVE RESEARCH</> : '✓ RESEARCH COMPLETE'}
              </div>
              <div className={styles.searchList}>
                {searches.map((q, i) => (
                  <div key={i} className={styles.searchItem}>
                    <span className={styles.searchIcon}>🔍</span>
                    <span>{q}</span>
                  </div>
                ))}
                {loading && !searches.length && (
                  <div className={styles.searchItem}>
                    <span className={styles.loader}></span>
                    <span className={styles.muted}>Initializing search...</span>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* Results */}
          {result && (
            <div className={`${styles.results} fade-in`}>
              {/* Top Pick Card */}
              <div className={styles.pickCard}>
                <div className={styles.pickLeft}>
                  <div className={styles.matchupDisplay}>
                    <div className={styles.teamBadge}>
                      {TEAM_ABBREV[awayTeam] || awayTeam.split(' ').pop()}
                    </div>
                    <div className={styles.atBig}>@</div>
                    <div className={styles.teamBadge}>
                      {TEAM_ABBREV[homeTeam] || homeTeam.split(' ').pop()}
                    </div>
                  </div>
                  {spread && (
                    <div className={styles.spreadDisplay}>
                      Spread: <strong>{homeTeam.split(' ').pop()} {spread}</strong>
                    </div>
                  )}
                </div>
                <div className={styles.pickRight}>
                  <div className={`${styles.recommendation} ${getRecommendationColor(result.recommendation)}`}>
                    {result.recommendation}
                  </div>
                  <div className={styles.confidenceLabel}>CONFIDENCE</div>
                  <div className={styles.confidenceRow}>
                    <div className={styles.confidenceBar}>
                      <div className={styles.confidenceFill} style={getConfidenceBar(result.confidence)}></div>
                    </div>
                    <span className={styles.confidenceNum}>{result.confidence}%</span>
                  </div>
                  {result.valueRating && (
                    <div className={styles.valueRating}>
                      VALUE: {'★'.repeat(Math.round(result.valueRating / 2))}{'☆'.repeat(5 - Math.round(result.valueRating / 2))}
                    </div>
                  )}
                </div>
              </div>

              {/* Summary */}
              {result.summary && (
                <div className={styles.summaryCard}>
                  <div className={styles.panelLabel}>ANALYST SUMMARY</div>
                  <p className={styles.summaryText}>{result.summary}</p>
                </div>
              )}

              {/* Predicted Score */}
              {result.predictedScore && (
                <div className={styles.scoreCard}>
                  <div className={styles.panelLabel}>PREDICTED SCORE</div>
                  <div className={styles.scoreDisplay}>
                    <div className={styles.scoreTeam}>
                      <div className={styles.scoreAbbrev}>{TEAM_ABBREV[awayTeam] || 'AWAY'}</div>
                      <div className={styles.scoreNum}>{result.predictedScore.away}</div>
                    </div>
                    <div className={styles.scoreDash}>—</div>
                    <div className={styles.scoreTeam}>
                      <div className={styles.scoreAbbrev}>{TEAM_ABBREV[homeTeam] || 'HOME'}</div>
                      <div className={styles.scoreNum}>{result.predictedScore.home}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Two Column Grid */}
              <div className={styles.twoCol}>
                {/* Pitcher Matchup */}
                {result.pitcherMatchup && (
                  <div className={styles.card}>
                    <div className={styles.panelLabel}>PITCHER MATCHUP</div>
                    <div className={styles.pitcherRow}>
                      <div className={styles.pitcher}>
                        <div className={styles.pitcherTeam}>{TEAM_ABBREV[awayTeam]}</div>
                        <div className={styles.pitcherName}>{result.pitcherMatchup.away?.name || 'TBD'}</div>
                        <div className={styles.pitcherEra}>ERA {result.pitcherMatchup.away?.era || '—'}</div>
                        <div className={styles.pitcherForm}>{result.pitcherMatchup.away?.recentForm}</div>
                      </div>
                      <div className={styles.pitcherVs}>VS</div>
                      <div className={styles.pitcher}>
                        <div className={styles.pitcherTeam}>{TEAM_ABBREV[homeTeam]}</div>
                        <div className={styles.pitcherName}>{result.pitcherMatchup.home?.name || 'TBD'}</div>
                        <div className={styles.pitcherEra}>ERA {result.pitcherMatchup.home?.era || '—'}</div>
                        <div className={styles.pitcherForm}>{result.pitcherMatchup.home?.recentForm}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Team Stats */}
                {result.teamStats && (
                  <div className={styles.card}>
                    <div className={styles.panelLabel}>TEAM STATS</div>
                    <table className={styles.statsTable}>
                      <thead>
                        <tr>
                          <th></th>
                          <th>{TEAM_ABBREV[awayTeam]}</th>
                          <th>{TEAM_ABBREV[homeTeam]}</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          <td>Record</td>
                          <td>{result.teamStats.away?.record || '—'}</td>
                          <td>{result.teamStats.home?.record || '—'}</td>
                        </tr>
                        <tr>
                          <td>Last 10</td>
                          <td>{result.teamStats.away?.lastTen || '—'}</td>
                          <td>{result.teamStats.home?.lastTen || '—'}</td>
                        </tr>
                        <tr>
                          <td>R/G</td>
                          <td>{result.teamStats.away?.runsPerGame || '—'}</td>
                          <td>{result.teamStats.home?.runsPerGame || '—'}</td>
                        </tr>
                        <tr>
                          <td>ERA</td>
                          <td>{result.teamStats.away?.era || '—'}</td>
                          <td>{result.teamStats.home?.era || '—'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Key Factors */}
              {result.keyFactors && result.keyFactors.length > 0 && (
                <div className={styles.card}>
                  <div className={styles.panelLabel}>KEY FACTORS</div>
                  <div className={styles.factorsList}>
                    {result.keyFactors.map((f, i) => (
                      <div key={i} className={styles.factor}>
                        <div className={styles.factorHeader}>
                          <span className={`${styles.factorImpact} ${
                            f.impact === 'positive' ? styles.green :
                            f.impact === 'negative' ? styles.red : styles.amber
                          }`}>
                            {f.impact === 'positive' ? '↑' : f.impact === 'negative' ? '↓' : '→'}
                          </span>
                          <span className={styles.factorName}>{f.factor}</span>
                        </div>
                        <div className={styles.factorDetail}>{f.detail}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Injuries */}
              {result.injuries && result.injuries.length > 0 && (
                <div className={styles.card}>
                  <div className={styles.panelLabel}>INJURY REPORT</div>
                  <div className={styles.injuryList}>
                    {result.injuries.map((inj, i) => (
                      <div key={i} className={styles.injuryItem}>
                        <span className={`${styles.injuryImpact} ${
                          inj.impact === 'high' ? styles.red :
                          inj.impact === 'medium' ? styles.amber : styles.muted
                        }`}>
                          {inj.impact?.toUpperCase()}
                        </span>
                        <span className={styles.injuryTeam}>{TEAM_ABBREV[inj.team] || inj.team}</span>
                        <span className={styles.injuryPlayer}>{inj.player}</span>
                        <span className={styles.injuryPos}>{inj.position}</span>
                        <span className={styles.injuryStatus}>{inj.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Spread Analysis + Weather */}
              <div className={styles.twoCol}>
                {result.spreadAnalysis && (
                  <div className={styles.card}>
                    <div className={styles.panelLabel}>SPREAD ANALYSIS</div>
                    <p className={styles.analysisText}>{result.spreadAnalysis}</p>
                  </div>
                )}
                {result.weatherImpact && (
                  <div className={styles.card}>
                    <div className={styles.panelLabel}>WEATHER & BALLPARK</div>
                    <p className={styles.analysisText}>{result.weatherImpact}</p>
                  </div>
                )}
              </div>

              {result.dataTimestamp && (
                <div className={styles.timestamp}>Data as of: {result.dataTimestamp}</div>
              )}
            </div>
          )}

          {/* History */}
          {history.length > 0 && (
            <section className={styles.historySection}>
              <div className={styles.panelLabel}>RECENT ANALYSES</div>
              <div className={styles.historyList}>
                {history.map(h => (
                  <button
                    key={h.id}
                    className={styles.historyItem}
                    onClick={() => {
                      setHomeTeam(h.homeTeam);
                      setAwayTeam(h.awayTeam);
                      setSpread(h.spread);
                      setGameDate(h.gameDate);
                      setResult(h.result);
                    }}
                  >
                    <span>{TEAM_ABBREV[h.awayTeam]} @ {TEAM_ABBREV[h.homeTeam]}</span>
                    <span className={`${
                      h.result.recommendation?.includes('NO') ? styles.red :
                      h.result.recommendation?.includes('COVER') ? styles.green : styles.amber
                    }`}>{h.result.recommendation}</span>
                    <span className={styles.muted}>{h.result.confidence}%</span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </main>

        <footer className={styles.footer}>
          For entertainment purposes only. Gamble responsibly. 21+
        </footer>
      </div>
    </>
  );
}
