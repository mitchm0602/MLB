import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Scoreboard.module.css';

const REFRESH_INTERVAL = 30000;
const ANALYSIS_CONCURRENCY = 1; // one at a time to respect rate limits
const sleep = ms => new Promise(r => setTimeout(r, ms));

function matchTeams(mlbName, oddsGames) {
  if (!mlbName || !oddsGames.length) return null;
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const mlbLast = mlbName.split(' ').pop().toLowerCase();
  for (const og of oddsGames) {
    if (norm(og.homeTeam) === norm(mlbName) || norm(og.awayTeam) === norm(mlbName)) return og;
    if (og.homeTeam.toLowerCase().includes(mlbLast) || og.awayTeam.toLowerCase().includes(mlbLast)) return og;
  }
  return null;
}

function fmtOdds(n) {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : `${n}`;
}

function confidenceColor(c) {
  if (c >= 8) return '#4afa9a';
  if (c >= 6) return '#e8f94a';
  if (c >= 4) return '#f9a83a';
  return '#ff4d4d';
}

// Run promises in batches
async function runConcurrent(tasks, concurrency) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      try { results[i] = await tasks[i](); } catch (e) { results[i] = { error: e.message }; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

export default function Scoreboard() {
  const [games, setGames] = useState([]);
  const [oddsMap, setOddsMap] = useState({});
  const [analysisMap, setAnalysisMap] = useState({});
  const [analysisPending, setAnalysisPending] = useState(new Set());
  const [oddsError, setOddsError] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [hasLive, setHasLive] = useState(false);
  const [oddsRemaining, setOddsRemaining] = useState(null);
  const [analysisDate, setAnalysisDate] = useState(null);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const runAnalysisForGames = useCallback(async (fetchedGames, oddsData, targetDate) => {
    const isPast = targetDate < new Date().toISOString().split('T')[0];
    if (isPast) return; // don't analyze past games

    const toAnalyze = fetchedGames.filter(g => g.status !== 'final' && g.status !== 'postponed');
    if (!toAnalyze.length) return;

    // Mark all as pending
    setAnalysisPending(new Set(toAnalyze.map(g => g.id)));

    const tasks = toAnalyze.map(game => async () => {
      const oddsEntry = oddsData[game.id];
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          homeTeam: game.home.name,
          awayTeam: game.away.name,
          gameDate: targetDate,
          homeSpread: oddsEntry?.spread?.homePoint ?? null,
          total: oddsEntry?.total?.point ?? null,
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    });

    // Run concurrently in batches, updating map as each completes
    let idx = 0;
    const pending = [...toAnalyze];
    async function worker() {
      while (idx < pending.length) {
        const i = idx++;
        const game = pending[i];
        try {
          if (i > 0) await sleep(5000); // 5s between requests to avoid rate limits
          const result = await tasks[i]();
          setAnalysisMap(prev => ({ ...prev, [game.id]: result }));
          // Auto-save picks to record tracker
          if (result && !result.error) {
            const picksToSave = [];
            if (result.spread?.pickSide && result.spread.pickSide !== 'pass') {
              picksToSave.push({
                gameId: game.id,
                gameDate: targetDate,
                awayTeam: game.away.name,
                homeTeam: game.home.name,
                awayAbbrev: game.away.abbrev,
                homeAbbrev: game.home.abbrev,
                pickType: 'spread',
                pick: result.spread.pick,
                pickSide: result.spread.pickSide,
                line: result.spread.line,
                confidence: result.spread.confidence,
                edge: result.spread.edge,
                result: 'pending',
              });
            }
            if (result.total?.pick && result.total.pick !== 'PASS') {
              picksToSave.push({
                gameId: game.id,
                gameDate: targetDate,
                awayTeam: game.away.name,
                homeTeam: game.home.name,
                awayAbbrev: game.away.abbrev,
                homeAbbrev: game.home.abbrev,
                pickType: 'total',
                pick: result.total.pick,
                line: result.total.line,
                confidence: result.total.confidence,
                edge: result.total.edge,
                result: 'pending',
              });
            }
            if (picksToSave.length) {
              fetch('/api/picks', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ picks: picksToSave })
              }).catch(() => {});
            }
          }
        } catch (e) {
          setAnalysisMap(prev => ({ ...prev, [game.id]: { error: e.message } }));
        }
        setAnalysisPending(prev => { const next = new Set(prev); next.delete(game.id); return next; });
      }
    }
    await Promise.all(Array.from({ length: ANALYSIS_CONCURRENCY }, worker));
    setAnalysisDate(targetDate);
  }, []);

  const fetchAll = useCallback(async (targetDate) => {
    const isPast = targetDate < new Date().toISOString().split('T')[0];
    const [scoresRes, oddsRes] = await Promise.allSettled([
      fetch(`/api/scores?date=${targetDate}`).then(r => r.json()),
      !isPast ? fetch('/api/odds').then(r => r.json()) : Promise.resolve({ odds: [] }),
    ]);

    let fetchedGames = [];
    let builtOddsMap = {};

    if (scoresRes.status === 'fulfilled' && !scoresRes.value.error) {
      fetchedGames = scoresRes.value.games || [];
      setFetchedAt(scoresRes.value.fetchedAt);
      setHasLive(fetchedGames.some(g => g.status === 'live'));

      if (oddsRes.status === 'fulfilled') {
        const oddsData = oddsRes.value;
        if (oddsData.error) setOddsError(oddsData.error); else setOddsError('');
        if (oddsData.remaining) setOddsRemaining(oddsData.remaining);
        for (const game of fetchedGames) {
          const match = matchTeams(game.home.name, oddsData.odds || []);
          if (match) {
            const hh = match.homeTeam.toLowerCase().includes(game.home.name.split(' ').pop().toLowerCase());
            builtOddsMap[game.id] = {
              moneyline: { home: hh ? match.moneyline.home : match.moneyline.away, away: hh ? match.moneyline.away : match.moneyline.home },
              spread: { homePoint: hh ? match.spread.homePoint : match.spread.awayPoint, awayPoint: hh ? match.spread.awayPoint : match.spread.homePoint, home: hh ? match.spread.home : match.spread.away, away: hh ? match.spread.away : match.spread.home },
              total: match.total,
              favored: hh ? match.favored : (match.favored === 'home' ? 'away' : 'home'),
            };
          }
        }
        setOddsMap(builtOddsMap);
      }
      setGames(fetchedGames);
      setError('');
    } else {
      setError(scoresRes.value?.error || 'Failed to fetch scores');
    }
    setLoading(false);

    // Kick off analysis for all games (only if we haven't already analyzed this date)
    if (fetchedGames.length && analysisDate !== targetDate) {
      runAnalysisForGames(fetchedGames, builtOddsMap, targetDate);
    }
  }, [analysisDate, runAnalysisForGames]);

  useEffect(() => {
    setLoading(true);
    setAnalysisMap({});
    setAnalysisPending(new Set());
    setAnalysisDate(null);
    fetchAll(date);
  }, [date]); // eslint-disable-line

  useEffect(() => {
    timerRef.current = setInterval(() => { fetchAll(date); setCountdown(REFRESH_INTERVAL / 1000); }, REFRESH_INTERVAL);
    countdownRef.current = setInterval(() => setCountdown(p => p <= 1 ? REFRESH_INTERVAL / 1000 : p - 1), 1000);
    return () => { clearInterval(timerRef.current); clearInterval(countdownRef.current); };
  }, [date, fetchAll]);

  const changeDate = (offset) => {
    const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split('T')[0]);
  };
  const formatDate = ds => new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const formatTime = iso => iso ? new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '';
  const isToday = date === new Date().toISOString().split('T')[0];
  const totalPending = analysisPending.size;
  const totalAnalyzed = Object.keys(analysisMap).length;

  const liveGames = games.filter(g => g.status === 'live');
  const scheduledGames = games.filter(g => g.status === 'scheduled');
  const finalGames = games.filter(g => g.status === 'final');
  const otherGames = games.filter(g => !['live','scheduled','final'].includes(g.status));

  return (
    <>
      <Head>
        <title>MLB Edge — Betting Assistant</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚾</text></svg>" />
      </Head>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.headerLeft}>
              <div className={styles.logo}>
                <span>⚾</span>
                <div>
                  <div className={styles.logoTitle}>MLB EDGE</div>
                  <div className={styles.logoSub}>AI Betting Assistant</div>
                </div>
              </div>
              <nav className={styles.nav}>
                <span className={styles.navActive}>Scoreboard</span>
                <Link href="/best-bets" className={styles.navLink}>Best Bets</Link>
                <Link href="/record" className={styles.navLink}>Record</Link>
              </nav>
            </div>
            <div className={styles.headerRight}>
              {totalPending > 0 && (
                <div className={styles.analysisBadge}>
                  <span className={styles.loader}></span>
                  Analyzing {totalAnalyzed}/{totalAnalyzed + totalPending} games
                </div>
              )}
              {totalPending === 0 && totalAnalyzed > 0 && (
                <div className={styles.analysisDone}>✓ {totalAnalyzed} games analyzed</div>
              )}
              {hasLive && <span className={styles.livePulse}></span>}
              <span className={styles.refreshText}>{hasLive ? 'LIVE · ' : ''}↻ {countdown}s</span>
              <button className={styles.refreshBtn} onClick={() => { setLoading(true); setAnalysisMap({}); setAnalysisPending(new Set()); setAnalysisDate(null); fetchAll(date); }}>Refresh</button>
            </div>
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.dateNav}>
            <button className={styles.dateBtn} onClick={() => changeDate(-1)}>←</button>
            <div className={styles.dateCenter}>
              <div className={styles.dateLabel}>{formatDate(date)}</div>
              {!isToday && <button className={styles.todayBtn} onClick={() => setDate(new Date().toISOString().split('T')[0])}>Today</button>}
            </div>
            <button className={styles.dateBtn} onClick={() => changeDate(1)}>→</button>
          </div>

          {fetchedAt && <div className={styles.fetchedAt}>Scores updated: {new Date(fetchedAt).toLocaleTimeString()}</div>}

          {oddsError?.includes('not configured') && (
            <div className={styles.oddsWarning}>⚠ Add ODDS_API_KEY for live betting lines — <a href="https://the-odds-api.com" target="_blank" rel="noreferrer" className={styles.oddsLink}>free key at the-odds-api.com</a></div>
          )}

          {loading && <div className={styles.loadingState}><span className={styles.loader}></span> Loading games...</div>}
          {error && <div className={styles.errorBar}>{error}</div>}
          {!loading && games.length === 0 && !error && <div className={styles.emptyState}><div className={styles.emptyIcon}>⚾</div><div>No games scheduled</div></div>}

          {liveGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}><span className={styles.liveDot}></span> LIVE — {liveGames.length} GAME{liveGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>{liveGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} analysis={analysisMap[g.id]} pending={analysisPending.has(g.id)} formatTime={formatTime} />)}</div>
            </section>
          )}
          {scheduledGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>SCHEDULED — {scheduledGames.length} GAME{scheduledGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>{scheduledGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} analysis={analysisMap[g.id]} pending={analysisPending.has(g.id)} formatTime={formatTime} />)}</div>
            </section>
          )}
          {finalGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>FINAL — {finalGames.length} GAME{finalGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>{finalGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} analysis={analysisMap[g.id]} pending={false} formatTime={formatTime} />)}</div>
            </section>
          )}
          {otherGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>OTHER</div>
              <div className={styles.gameGrid}>{otherGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} analysis={analysisMap[g.id]} pending={analysisPending.has(g.id)} formatTime={formatTime} />)}</div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function GameCard({ game, odds, analysis, pending, formatTime }) {
  const [expanded, setExpanded] = useState(false);
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const isScheduled = game.status === 'scheduled';
  const awayWin = isFinal && game.away.score > game.home.score;
  const homeWin = isFinal && game.home.score > game.away.score;
  const awayLeads = isLive && game.away.score > game.home.score;
  const homeLeads = isLive && game.home.score > game.away.score;
  const awayFavored = odds?.favored === 'away';
  const homeFavored = odds?.favored === 'home';

  // Determine pick display from analysis
  const spreadPick = analysis?.spread;
  const totalPick = analysis?.total;
  const spreadPickName = spreadPick?.pickSide === 'away' ? game.away.abbrev : spreadPick?.pickSide === 'home' ? game.home.abbrev : null;

  return (
    <div className={`${styles.gameCard} ${isLive ? styles.liveCard : ''}`}>
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
        {/* Away */}
        <div className={`${styles.teamRow} ${(awayWin || awayLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            {awayFavored && <span className={styles.favoredDot}>◆</span>}
            <span className={styles.teamAbbrev}>{game.away.abbrev}</span>
            <span className={styles.teamName}>{game.away.name}</span>
            {game.away.record && <span className={styles.teamRecord}>{game.away.record}</span>}
          </div>
          <div className={styles.teamRight}>
            {odds && <div className={styles.oddsCol}><span className={styles.oddsML}>{fmtOdds(odds.moneyline.away)}</span><span className={styles.oddsSpread}>{odds.spread.awayPoint != null ? fmtOdds(odds.spread.awayPoint) : '—'}</span></div>}
            {(isLive || isFinal) && <div className={styles.scoreBox}><span className={styles.score}>{game.away.score ?? ''}</span>{game.away.hits != null && <span className={styles.hits}>{game.away.hits}H</span>}</div>}
          </div>
        </div>

        {/* O/U divider */}
        <div className={styles.dividerRow}>
          <div className={styles.teamDivider}></div>
          {odds?.total?.point != null && (
            <div className={styles.totalBadge}>
              <span className={styles.totalLabel}>O/U</span>
              <span className={styles.totalVal}>{odds.total.point}</span>
              <span className={styles.totalOdds}>{fmtOdds(odds.total.over)}</span>
            </div>
          )}
          <div className={styles.teamDivider}></div>
        </div>

        {/* Home */}
        <div className={`${styles.teamRow} ${(homeWin || homeLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            {homeFavored && <span className={styles.favoredDot}>◆</span>}
            <span className={styles.teamAbbrev}>{game.home.abbrev}</span>
            <span className={styles.teamName}>{game.home.name}</span>
            {game.home.record && <span className={styles.teamRecord}>{game.home.record}</span>}
          </div>
          <div className={styles.teamRight}>
            {odds && <div className={styles.oddsCol}><span className={styles.oddsML}>{fmtOdds(odds.moneyline.home)}</span><span className={styles.oddsSpread}>{odds.spread.homePoint != null ? fmtOdds(odds.spread.homePoint) : '—'}</span></div>}
            {(isLive || isFinal) && <div className={styles.scoreBox}><span className={styles.score}>{game.home.score ?? ''}</span>{game.home.hits != null && <span className={styles.hits}>{game.home.hits}H</span>}</div>}
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

      {/* AI Betting Picks — always visible */}
      {pending && !analysis && (
        <div className={styles.picksPending}>
          <span className={styles.loader}></span>
          <span>AI analyzing matchup...</span>
        </div>
      )}

      {analysis?.error && (
        <div className={styles.picksError}>⚠ {analysis.error}{analysis.detail ? ': ' + analysis.detail : ''}</div>
      )}

      {analysis && !analysis.error && (
        <>
          {/* Compact picks row */}
          <div className={styles.picksRow}>
            <div className={styles.pickBox}>
              <div className={styles.pickBoxLabel}>SPREAD PICK</div>
              <div className={`${styles.pickBoxValue} ${spreadPick?.pickSide === 'pass' ? styles.pickPass : styles.pickHighlight}`}>
                {spreadPick?.pickSide === 'pass' ? 'PASS' : spreadPickName || '—'}
                {spreadPick?.line && spreadPick?.pickSide !== 'pass' ? ` ${spreadPick.line}` : ''}
              </div>
              <ConfidenceDots score={spreadPick?.confidence} />
            </div>
            <div className={styles.pickDivider}></div>
            <div className={styles.pickBox}>
              <div className={styles.pickBoxLabel}>O/U PICK</div>
              <div className={`${styles.pickBoxValue} ${totalPick?.pick === 'PASS' ? styles.pickPass : styles.pickHighlight}`}>
                {totalPick?.pick || '—'}
                {totalPick?.line && totalPick?.pick !== 'PASS' ? ` ${totalPick.line}` : ''}
              </div>
              <ConfidenceDots score={totalPick?.confidence} />
            </div>
            <div className={styles.pickDivider}></div>
            <div className={styles.pickBox}>
              <div className={styles.pickBoxLabel}>PREDICTED</div>
              <div className={styles.predScoreInline}>
                <span>{game.away.abbrev} {analysis.predictedScore?.away}</span>
                <span className={styles.predDash}>—</span>
                <span>{game.home.abbrev} {analysis.predictedScore?.home}</span>
              </div>
            </div>
          </div>

          {/* Expand for full detail */}
          <button className={styles.detailToggle} onClick={() => setExpanded(e => !e)}>
            {expanded ? '▲ Hide Detail' : '▼ Full Analysis'}
          </button>

          {expanded && (
            <div className={styles.expandedDetail}>
              {/* Pitchers */}
              {analysis.pitchers && (
                <div className={styles.detailSection}>
                  <div className={styles.detailLabel}>PITCHERS</div>
                  <div className={styles.pitcherRow}>
                    <div className={styles.pitcher}>
                      <span className={styles.pitcherTeam}>{game.away.abbrev}</span>
                      <span className={styles.pitcherName}>{analysis.pitchers.away?.name || 'TBD'}</span>
                      <span className={styles.pitcherEra}>{analysis.pitchers.away?.era} ERA</span>
                      <span className={styles.pitcherNote}>{analysis.pitchers.away?.note}</span>
                    </div>
                    <span className={styles.pitcherVs}>VS</span>
                    <div className={styles.pitcher}>
                      <span className={styles.pitcherTeam}>{game.home.abbrev}</span>
                      <span className={styles.pitcherName}>{analysis.pitchers.home?.name || 'TBD'}</span>
                      <span className={styles.pitcherEra}>{analysis.pitchers.home?.era} ERA</span>
                      <span className={styles.pitcherNote}>{analysis.pitchers.home?.note}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Team Stats */}
              {analysis.teamStats && (
                <div className={styles.detailSection}>
                  <div className={styles.detailLabel}>TEAM STATS</div>
                  <table className={styles.statsTable}>
                    <thead><tr><th></th><th>{game.away.abbrev}</th><th>{game.home.abbrev}</th></tr></thead>
                    <tbody>
                      <tr><td>Record</td><td>{analysis.teamStats.away?.record}</td><td>{analysis.teamStats.home?.record}</td></tr>
                      <tr><td>Last 10</td><td>{analysis.teamStats.away?.last10}</td><td>{analysis.teamStats.home?.last10}</td></tr>
                      <tr><td>R/G</td><td>{analysis.teamStats.away?.rpg}</td><td>{analysis.teamStats.home?.rpg}</td></tr>
                      <tr><td>ERA</td><td>{analysis.teamStats.away?.era}</td><td>{analysis.teamStats.home?.era}</td></tr>
                      <tr><td>OPS</td><td>{analysis.teamStats.away?.ops}</td><td>{analysis.teamStats.home?.ops}</td></tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Injuries */}
              {analysis.keyInjuries?.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.detailLabel}>KEY INJURIES</div>
                  {analysis.keyInjuries.map((inj, i) => (
                    <div key={i} className={styles.injuryRow}>
                      <span className={`${styles.injImpact} ${inj.impact === 'high' ? styles.impactHigh : inj.impact === 'medium' ? styles.impactMed : styles.impactLow}`}>{inj.impact?.toUpperCase()}</span>
                      <span className={styles.injTeam}>{inj.team === 'away' ? game.away.abbrev : game.home.abbrev}</span>
                      <span className={styles.injPlayer}>{inj.player}</span>
                      <span className={styles.injStatus}>{inj.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Top Factors */}
              {analysis.topFactors?.length > 0 && (
                <div className={styles.detailSection}>
                  <div className={styles.detailLabel}>KEY FACTORS</div>
                  {analysis.topFactors.map((f, i) => (
                    <div key={i} className={styles.factorRow}>
                      <span className={`${styles.factorSide} ${
                        ['away','under'].includes(f.side) ? styles.factorRed :
                        ['home','over'].includes(f.side) ? styles.factorGreen :
                        styles.factorNeutral
                      }`}>{f.label}</span>
                      <span className={styles.factorDetail}>{f.detail}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Spread + Total edge */}
              <div className={styles.edgeRow}>
                {spreadPick?.edge && (
                  <div className={styles.edgeBox}>
                    <div className={styles.detailLabel}>SPREAD EDGE</div>
                    <p className={styles.edgeText}>{spreadPick.edge}</p>
                  </div>
                )}
                {totalPick?.edge && (
                  <div className={styles.edgeBox}>
                    <div className={styles.detailLabel}>TOTAL EDGE</div>
                    <p className={styles.edgeText}>{totalPick.edge}</p>
                  </div>
                )}
              </div>

              {/* Weather */}
              {analysis.weather && (
                <div className={styles.detailSection}>
                  <div className={styles.detailLabel}>WEATHER & BALLPARK</div>
                  <p className={styles.weatherText}>{analysis.weather}</p>
                </div>
              )}

              {/* Summary */}
              {analysis.summary && (
                <div className={styles.summaryBox}>
                  <p>{analysis.summary}</p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Probable pitchers (scheduled, no analysis yet) */}
      {isScheduled && !analysis && !pending && (game.away.probablePitcher || game.home.probablePitcher) && (
        <div className={styles.pitchers}>
          <div className={styles.pitcher}><span className={styles.pitcherTeam}>{game.away.abbrev}</span><span className={styles.pitcherName}>{game.away.probablePitcher?.name || 'TBD'}</span></div>
          <span className={styles.pitcherVs}>vs</span>
          <div className={styles.pitcher}><span className={styles.pitcherTeam}>{game.home.abbrev}</span><span className={styles.pitcherName}>{game.home.probablePitcher?.name || 'TBD'}</span></div>
        </div>
      )}
    </div>
  );
}

function ConfidenceDots({ score }) {
  if (score == null) return null;
  const filled = Math.round(score);
  const color = confidenceColor(score);
  return (
    <div className={styles.confDots}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={styles.confDot} style={{ background: i < filled ? color : 'var(--border2)' }}></span>
      ))}
      <span className={styles.confScore} style={{ color }}>{score}/10</span>
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
