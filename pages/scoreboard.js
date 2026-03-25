import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import styles from '../styles/Scoreboard.module.css';

const REFRESH_INTERVAL = 30000;

function matchTeams(mlbName, oddsGames) {
  if (!mlbName || !oddsGames.length) return null;
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const mlbNorm = norm(mlbName);
  const mlbLast = mlbName.split(' ').pop().toLowerCase();
  for (const og of oddsGames) {
    if (norm(og.homeTeam) === mlbNorm || norm(og.awayTeam) === mlbNorm) return og;
    if (og.homeTeam.toLowerCase().includes(mlbLast) || og.awayTeam.toLowerCase().includes(mlbLast)) return og;
  }
  return null;
}

function formatOdds(n) {
  if (n === null || n === undefined) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

export default function Scoreboard() {
  const [games, setGames] = useState([]);
  const [oddsMap, setOddsMap] = useState({});
  const [oddsError, setOddsError] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [hasLive, setHasLive] = useState(false);
  const [oddsRemaining, setOddsRemaining] = useState(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchAll = useCallback(async (targetDate) => {
    const isToday = targetDate === new Date().toISOString().split('T')[0];
    const isPast = targetDate < new Date().toISOString().split('T')[0];
    const [scoresRes, oddsRes] = await Promise.allSettled([
      fetch(`/api/scores?date=${targetDate}`).then(r => r.json()),
      !isPast ? fetch('/api/odds').then(r => r.json()) : Promise.resolve({ odds: [] }),
    ]);

    if (scoresRes.status === 'fulfilled' && !scoresRes.value.error) {
      const fetchedGames = scoresRes.value.games || [];
      setFetchedAt(scoresRes.value.fetchedAt);
      setHasLive(fetchedGames.some(g => g.status === 'live'));

      if (oddsRes.status === 'fulfilled') {
        const oddsData = oddsRes.value;
        if (oddsData.error) setOddsError(oddsData.error);
        else setOddsError('');
        if (oddsData.remaining) setOddsRemaining(oddsData.remaining);

        const map = {};
        for (const game of fetchedGames) {
          const match = matchTeams(game.home.name, oddsData.odds || []);
          if (match) {
            const oddsHomeIsHome = match.homeTeam.toLowerCase().includes(game.home.name.split(' ').pop().toLowerCase());
            map[game.id] = {
              moneyline: {
                home: oddsHomeIsHome ? match.moneyline.home : match.moneyline.away,
                away: oddsHomeIsHome ? match.moneyline.away : match.moneyline.home,
              },
              spread: {
                homePoint: oddsHomeIsHome ? match.spread.homePoint : match.spread.awayPoint,
                awayPoint: oddsHomeIsHome ? match.spread.awayPoint : match.spread.homePoint,
                home: oddsHomeIsHome ? match.spread.home : match.spread.away,
                away: oddsHomeIsHome ? match.spread.away : match.spread.home,
              },
              total: match.total,
              favored: oddsHomeIsHome ? match.favored : (match.favored === 'home' ? 'away' : 'home'),
            };
          }
        }
        setOddsMap(map);
      }
      setGames(fetchedGames);
      setError('');
    } else {
      setError(scoresRes.value?.error || 'Failed to fetch scores');
    }
    setLoading(false);
  }, []);

  useEffect(() => { setLoading(true); fetchAll(date); }, [date, fetchAll]);

  useEffect(() => {
    timerRef.current = setInterval(() => { fetchAll(date); setCountdown(REFRESH_INTERVAL / 1000); }, REFRESH_INTERVAL);
    countdownRef.current = setInterval(() => { setCountdown(p => p <= 1 ? REFRESH_INTERVAL / 1000 : p - 1); }, 1000);
    return () => { clearInterval(timerRef.current); clearInterval(countdownRef.current); };
  }, [date, fetchAll]);

  const changeDate = (offset) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split('T')[0]);
  };
  const formatDate = (ds) => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const formatTime = (iso) => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';
  const isToday = date === new Date().toISOString().split('T')[0];

  const liveGames = games.filter(g => g.status === 'live');
  const scheduledGames = games.filter(g => g.status === 'scheduled');
  const finalGames = games.filter(g => g.status === 'final');
  const otherGames = games.filter(g => !['live','scheduled','final'].includes(g.status));

  return (
    <>
      <Head>
        <title>MLB Edge — Scoreboard</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚾</text></svg>" />
      </Head>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.logo}>
              <span>⚾</span>
              <div>
                <div className={styles.logoTitle}>MLB EDGE</div>
                <div className={styles.logoSub}>AI Spread Analyzer</div>
              </div>
            </div>
            <div className={styles.refreshStatus}>
              {hasLive && <span className={styles.livePulse}></span>}
              <span className={styles.refreshText}>{hasLive ? 'LIVE · ' : ''}Refreshes in {countdown}s</span>
              {oddsRemaining && <span className={styles.oddsRemaining}>{oddsRemaining} odds calls left</span>}
              <button className={styles.refreshBtn} onClick={() => { setLoading(true); fetchAll(date); }}>↻</button>
            </div>
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.dateNav}>
            <button className={styles.dateBtn} onClick={() => changeDate(-1)}>←</button>
            <div className={styles.dateCenter}>
              <div className={styles.dateLabel}>{formatDate(date)}</div>
              {!isToday && <button className={styles.todayBtn} onClick={() => setDate(new Date().toISOString().split('T')[0])}>Back to Today</button>}
            </div>
            <button className={styles.dateBtn} onClick={() => changeDate(1)}>→</button>
          </div>

          {fetchedAt && <div className={styles.fetchedAt}>Last updated: {new Date(fetchedAt).toLocaleTimeString()}</div>}

          {oddsError && oddsError.includes('not configured') && (
            <div className={styles.oddsWarning}>
              ⚠ Add ODDS_API_KEY to Vercel env vars for live lines —{' '}
              <a href="https://the-odds-api.com" target="_blank" rel="noreferrer" className={styles.oddsLink}>get free key</a>
            </div>
          )}
          {oddsError && !oddsError.includes('not configured') && (
            <div className={styles.oddsWarning}>⚠ Odds unavailable: {oddsError}</div>
          )}

          {loading && <div className={styles.loadingState}><span className={styles.loader}></span><span>Loading games...</span></div>}
          {error && <div className={styles.errorBar}>{error}</div>}
          {!loading && games.length === 0 && !error && (
            <div className={styles.emptyState}><div className={styles.emptyIcon}>⚾</div><div>No games scheduled</div></div>
          )}

          {liveGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}><span className={styles.liveDot}></span> LIVE — {liveGames.length} GAME{liveGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>{liveGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}</div>
            </section>
          )}
          {scheduledGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>SCHEDULED — {scheduledGames.length} GAME{scheduledGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>{scheduledGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}</div>
            </section>
          )}
          {finalGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>FINAL — {finalGames.length} GAME{finalGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>{finalGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}</div>
            </section>
          )}
          {otherGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>OTHER</div>
              <div className={styles.gameGrid}>{otherGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}</div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function GameCard({ game, odds, formatTime }) {
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisSearches, setAnalysisSearches] = useState([]);
  const [analysisError, setAnalysisError] = useState('');

  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const isScheduled = game.status === 'scheduled';
  const awayWin = isFinal && game.away.score > game.home.score;
  const homeWin = isFinal && game.home.score > game.away.score;
  const awayLeads = isLive && game.away.score > game.home.score;
  const homeLeads = isLive && game.home.score > game.away.score;
  const awayFavored = odds?.favored === 'away';
  const homeFavored = odds?.favored === 'home';

  const runAnalysis = async () => {
    if (analysisResult) { setAnalysisOpen(o => !o); return; }
    setAnalysisOpen(true);
    setAnalysisLoading(true);
    setAnalysisSearches([]);
    setAnalysisError('');

    const spread = odds?.spread?.homePoint != null ? String(odds.spread.homePoint) : '';
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ homeTeam: game.home.name, awayTeam: game.away.name, spread, gameDate: game.startTime?.split('T')[0] })
      });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', accumulated = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'search') setAnalysisSearches(p => [...p, data.query]);
            else if (data.type === 'text') accumulated += data.text;
            else if (data.type === 'done') {
              const match = accumulated.match(/\{[\s\S]*\}/);
              if (match) setAnalysisResult(JSON.parse(match[0]));
            }
          } catch {}
        }
      }
    } catch (e) {
      setAnalysisError(e.message);
    } finally {
      setAnalysisLoading(false);
    }
  };

  return (
    <div className={`${styles.gameCard} ${isLive ? styles.liveCard : ''} ${analysisOpen ? styles.expandedCard : ''}`}>
      {/* Status + venue */}
      <div className={styles.cardTop}>
        {isLive && <span className={styles.statusLive}><span className={styles.liveDotSmall}></span>{game.inningHalf === 'Top' ? '▲' : '▼'} {game.inning}</span>}
        {isFinal && <span className={styles.statusFinal}>{game.detailedStatus || 'FINAL'}</span>}
        {isScheduled && <span className={styles.statusScheduled}>{formatTime(game.startTime)}</span>}
        {!['live','final','scheduled'].includes(game.status) && <span className={styles.statusOther}>{game.detailedStatus}</span>}
        <span className={styles.venue}>{game.venue}</span>
      </div>

      {/* Teams + Lines + Scores */}
      <div className={styles.teams}>
        <div className={`${styles.teamRow} ${(awayWin || awayLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            {awayFavored && <span className={styles.favoredDot}>◆</span>}
            <span className={styles.teamAbbrev}>{game.away.abbrev}</span>
            <span className={styles.teamName}>{game.away.name}</span>
            {game.away.record && <span className={styles.teamRecord}>{game.away.record}</span>}
          </div>
          <div className={styles.teamRight}>
            {odds && <div className={styles.oddsCol}><span className={styles.oddsML}>{formatOdds(odds.moneyline.away)}</span><span className={styles.oddsSpread}>{odds.spread.awayPoint != null ? formatOdds(odds.spread.awayPoint) : '—'}</span></div>}
            {(isLive || isFinal) && <div className={styles.scoreBox}><span className={styles.score}>{game.away.score ?? ''}</span>{game.away.hits !== null && <span className={styles.hits}>{game.away.hits}H</span>}</div>}
          </div>
        </div>

        <div className={styles.dividerRow}>
          <div className={styles.teamDivider}></div>
          {odds?.total?.point != null && (
            <div className={styles.totalBadge}>
              <span className={styles.totalLabel}>O/U</span>
              <span className={styles.totalVal}>{odds.total.point}</span>
              <span className={styles.totalOdds}>{formatOdds(odds.total.over)}</span>
            </div>
          )}
          <div className={styles.teamDivider}></div>
        </div>

        <div className={`${styles.teamRow} ${(homeWin || homeLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            {homeFavored && <span className={styles.favoredDot}>◆</span>}
            <span className={styles.teamAbbrev}>{game.home.abbrev}</span>
            <span className={styles.teamName}>{game.home.name}</span>
            {game.home.record && <span className={styles.teamRecord}>{game.home.record}</span>}
          </div>
          <div className={styles.teamRight}>
            {odds && <div className={styles.oddsCol}><span className={styles.oddsML}>{formatOdds(odds.moneyline.home)}</span><span className={styles.oddsSpread}>{odds.spread.homePoint != null ? formatOdds(odds.spread.homePoint) : '—'}</span></div>}
            {(isLive || isFinal) && <div className={styles.scoreBox}><span className={styles.score}>{game.home.score ?? ''}</span>{game.home.hits !== null && <span className={styles.hits}>{game.home.hits}H</span>}</div>}
          </div>
        </div>
      </div>

      {odds && (
        <div className={styles.oddsHeader}>
          <span></span>
          <span className={styles.oddsHeaderLabel}>ML</span>
          <span className={styles.oddsHeaderLabel}>SPREAD</span>
          {(isLive || isFinal) && <span className={styles.oddsHeaderLabel}>SCORE</span>}
        </div>
      )}

      {isLive && (
        <div className={styles.liveDetails}>
          <div className={styles.count}>{game.balls}-{game.strikes} · {game.outs} OUT{game.outs !== 1 ? 'S' : ''}</div>
          <BaseDiamond first={game.onFirst} second={game.onSecond} third={game.onThird} />
        </div>
      )}

      {isScheduled && (game.away.probablePitcher || game.home.probablePitcher) && (
        <div className={styles.pitchers}>
          <div className={styles.pitcher}><span className={styles.pitcherTeam}>{game.away.abbrev}</span><span className={styles.pitcherName}>{game.away.probablePitcher?.name || 'TBD'}</span></div>
          <span className={styles.pitcherVs}>vs</span>
          <div className={styles.pitcher}><span className={styles.pitcherTeam}>{game.home.abbrev}</span><span className={styles.pitcherName}>{game.home.probablePitcher?.name || 'TBD'}</span></div>
        </div>
      )}

      {game.weather && isScheduled && <div className={styles.weather}>{game.weather}</div>}

      {/* Analyze Button */}
      <button className={`${styles.analyzeBtn} ${analysisOpen ? styles.analyzeBtnActive : ''}`} onClick={runAnalysis}>
        {analysisLoading ? <><span className={styles.btnLoader}></span> ANALYZING...</> :
         analysisOpen && analysisResult ? '▲ HIDE ANALYSIS' :
         `⚡ ANALYZE${odds?.spread?.homePoint != null ? ` · ${game.home.abbrev} ${formatOdds(odds.spread.homePoint)}` : ''}`}
      </button>

      {/* Inline Analysis Panel */}
      {analysisOpen && (
        <div className={styles.analysisPanel}>
          {/* Search feed */}
          {(analysisLoading || analysisSearches.length > 0) && (
            <div className={styles.searchFeed}>
              <div className={styles.searchFeedLabel}>{analysisLoading ? '🔍 RESEARCHING' : '✓ RESEARCH COMPLETE'}</div>
              {analysisSearches.map((q, i) => <div key={i} className={styles.searchItem}>→ {q}</div>)}
            </div>
          )}

          {analysisError && <div className={styles.analysisError}>{analysisError}</div>}

          {analysisResult && <AnalysisResult result={analysisResult} homeTeam={game.home.name} awayTeam={game.away.name} homeAbbrev={game.home.abbrev} awayAbbrev={game.away.abbrev} />}
        </div>
      )}
    </div>
  );
}

function AnalysisResult({ result, homeTeam, awayTeam, homeAbbrev, awayAbbrev }) {
  const recColor = r => {
    if (!r) return '';
    if (r.includes('NO COVER')) return styles.recRed;
    if (r.includes('COVER')) return styles.recGreen;
    if (r.includes('LEAN')) return styles.recAmber;
    return styles.recMuted;
  };

  const confStyle = (c) => {
    if (c >= 70) return '#4afa9a';
    if (c >= 55) return '#e8f94a';
    return '#ff4d4d';
  };

  return (
    <div className={styles.analysisResult}>
      {/* Pick header */}
      <div className={styles.pickHeader}>
        <div className={`${styles.pickRec} ${recColor(result.recommendation)}`}>{result.recommendation}</div>
        <div className={styles.pickMeta}>
          <div className={styles.confRow}>
            <span className={styles.confLabel}>CONFIDENCE</span>
            <div className={styles.confBar}><div className={styles.confFill} style={{ width: `${result.confidence}%`, background: confStyle(result.confidence) }}></div></div>
            <span className={styles.confNum}>{result.confidence}%</span>
          </div>
          {result.valueRating && <div className={styles.valueRating}>VALUE {'★'.repeat(Math.round(result.valueRating / 2))}{'☆'.repeat(5 - Math.round(result.valueRating / 2))}</div>}
        </div>
      </div>

      {result.summary && <p className={styles.summary}>{result.summary}</p>}

      {/* Predicted score */}
      {result.predictedScore && (
        <div className={styles.predScore}>
          <span className={styles.predTeam}>{awayAbbrev}</span>
          <span className={styles.predNum}>{result.predictedScore.away}</span>
          <span className={styles.predDash}>—</span>
          <span className={styles.predNum}>{result.predictedScore.home}</span>
          <span className={styles.predTeam}>{homeAbbrev}</span>
          <span className={styles.predLabel}>PREDICTED</span>
        </div>
      )}

      {/* Key factors */}
      {result.keyFactors?.length > 0 && (
        <div className={styles.factors}>
          <div className={styles.factorsLabel}>KEY FACTORS</div>
          {result.keyFactors.map((f, i) => (
            <div key={i} className={styles.factor}>
              <span className={f.impact === 'positive' ? styles.recGreen : f.impact === 'negative' ? styles.recRed : styles.recAmber}>
                {f.impact === 'positive' ? '↑' : f.impact === 'negative' ? '↓' : '→'}
              </span>
              <div>
                <div className={styles.factorName}>{f.factor}</div>
                <div className={styles.factorDetail}>{f.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Injuries */}
      {result.injuries?.length > 0 && (
        <div className={styles.injuries}>
          <div className={styles.factorsLabel}>INJURY REPORT</div>
          {result.injuries.map((inj, i) => (
            <div key={i} className={styles.injury}>
              <span className={`${styles.injImpact} ${inj.impact === 'high' ? styles.recRed : inj.impact === 'medium' ? styles.recAmber : styles.recMuted}`}>{inj.impact?.toUpperCase()}</span>
              <span className={styles.injTeam}>{inj.team?.split(' ').pop()}</span>
              <span className={styles.injPlayer}>{inj.player}</span>
              <span className={styles.injStatus}>{inj.status}</span>
            </div>
          ))}
        </div>
      )}

      {result.spreadAnalysis && <p className={styles.spreadNote}>{result.spreadAnalysis}</p>}
    </div>
  );
}

function BaseDiamond({ first, second, third }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36">
      <rect x="13" y="1" width="10" height="10" rx="1" transform="rotate(45 18 6)" fill={second ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
      <rect x="1" y="13" width="10" height="10" rx="1" transform="rotate(45 6 18)" fill={third ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
      <rect x="25" y="13" width="10" height="10" rx="1" transform="rotate(45 30 18)" fill={first ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
    </svg>
  );
}
