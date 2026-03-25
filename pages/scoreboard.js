import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Scoreboard.module.css';

const REFRESH_INTERVAL = 30000; // 30 seconds

export default function Scoreboard() {
  const [games, setGames] = useState([]);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [hasLive, setHasLive] = useState(false);
  const timerRef = useRef(null);
  const countdownRef = useRef(null);

  const fetchScores = useCallback(async (targetDate) => {
    try {
      const res = await fetch(`/api/scores?date=${targetDate}`);
      if (!res.ok) throw new Error('Failed to fetch scores');
      const data = await res.json();
      setGames(data.games || []);
      setFetchedAt(data.fetchedAt);
      setHasLive(data.games?.some(g => g.status === 'live'));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + date changes
  useEffect(() => {
    setLoading(true);
    fetchScores(date);
  }, [date, fetchScores]);

  // Auto-refresh
  useEffect(() => {
    const startRefresh = () => {
      setCountdown(REFRESH_INTERVAL / 1000);

      timerRef.current = setInterval(() => {
        fetchScores(date);
        setCountdown(REFRESH_INTERVAL / 1000);
      }, REFRESH_INTERVAL);

      countdownRef.current = setInterval(() => {
        setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL / 1000 : prev - 1));
      }, 1000);
    };

    startRefresh();
    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [date, fetchScores]);

  const goToToday = () => setDate(new Date().toISOString().split('T')[0]);
  const changeDate = (offset) => {
    const d = new Date(date);
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split('T')[0]);
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  };

  const formatTime = (isoString) => {
    if (!isoString) return '';
    return new Date(isoString).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
    });
  };

  const isToday = date === new Date().toISOString().split('T')[0];

  const liveGames = games.filter(g => g.status === 'live');
  const scheduledGames = games.filter(g => g.status === 'scheduled');
  const finalGames = games.filter(g => g.status === 'final');
  const otherGames = games.filter(g => !['live','scheduled','final'].includes(g.status));

  return (
    <>
      <Head>
        <title>Scoreboard — MLB Edge</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚾</text></svg>" />
      </Head>

      <div className={styles.app}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.headerLeft}>
              <Link href="/" className={styles.logo}>
                <span>⚾</span>
                <div>
                  <div className={styles.logoTitle}>MLB EDGE</div>
                  <div className={styles.logoSub}>AI Spread Analyzer</div>
                </div>
              </Link>
              <nav className={styles.nav}>
                <Link href="/" className={styles.navLink}>Analyzer</Link>
                <span className={styles.navLinkActive}>Scoreboard</span>
              </nav>
            </div>
            <div className={styles.refreshStatus}>
              {hasLive && <span className={styles.livePulse}></span>}
              <span className={styles.refreshText}>
                {hasLive ? 'LIVE · ' : ''}Refreshes in {countdown}s
              </span>
              <button className={styles.refreshBtn} onClick={() => fetchScores(date)}>↻</button>
            </div>
          </div>
        </header>

        <main className={styles.main}>
          {/* Date Nav */}
          <div className={styles.dateNav}>
            <button className={styles.dateBtn} onClick={() => changeDate(-1)}>←</button>
            <div className={styles.dateCenter}>
              <div className={styles.dateLabel}>{formatDate(date)}</div>
              {!isToday && (
                <button className={styles.todayBtn} onClick={goToToday}>Back to Today</button>
              )}
            </div>
            <button className={styles.dateBtn} onClick={() => changeDate(1)}>→</button>
          </div>

          {fetchedAt && (
            <div className={styles.fetchedAt}>
              Last updated: {new Date(fetchedAt).toLocaleTimeString()}
            </div>
          )}

          {loading && (
            <div className={styles.loadingState}>
              <span className={styles.loader}></span>
              <span>Loading games...</span>
            </div>
          )}

          {error && <div className={styles.errorBar}>{error}</div>}

          {!loading && games.length === 0 && !error && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>⚾</div>
              <div>No games scheduled for this date</div>
            </div>
          )}

          {/* Live Games */}
          {liveGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>
                <span className={styles.liveDot}></span> LIVE — {liveGames.length} GAME{liveGames.length > 1 ? 'S' : ''}
              </div>
              <div className={styles.gameGrid}>
                {liveGames.map(g => <GameCard key={g.id} game={g} />)}
              </div>
            </section>
          )}

          {/* Scheduled Games */}
          {scheduledGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>
                SCHEDULED — {scheduledGames.length} GAME{scheduledGames.length > 1 ? 'S' : ''}
              </div>
              <div className={styles.gameGrid}>
                {scheduledGames.map(g => <GameCard key={g.id} game={g} formatTime={formatTime} />)}
              </div>
            </section>
          )}

          {/* Final Games */}
          {finalGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>
                FINAL — {finalGames.length} GAME{finalGames.length > 1 ? 'S' : ''}
              </div>
              <div className={styles.gameGrid}>
                {finalGames.map(g => <GameCard key={g.id} game={g} />)}
              </div>
            </section>
          )}

          {/* Postponed/Suspended */}
          {otherGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>OTHER</div>
              <div className={styles.gameGrid}>
                {otherGames.map(g => <GameCard key={g.id} game={g} />)}
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function GameCard({ game, formatTime }) {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const isScheduled = game.status === 'scheduled';

  const awayWin = isFinal && game.away.score > game.home.score;
  const homeWin = isFinal && game.home.score > game.away.score;
  const awayLeads = isLive && game.away.score > game.home.score;
  const homeLeads = isLive && game.home.score > game.away.score;

  const handleAnalyze = () => {
    const url = `/?away=${encodeURIComponent(game.away.name)}&home=${encodeURIComponent(game.home.name)}`;
    window.location.href = url;
  };

  return (
    <div className={`${styles.gameCard} ${isLive ? styles.liveCard : ''}`}>
      {/* Status bar */}
      <div className={styles.cardTop}>
        {isLive && (
          <span className={styles.statusLive}>
            <span className={styles.liveDotSmall}></span>
            {game.inningHalf === 'Top' ? '▲' : '▼'} {game.inning}
          </span>
        )}
        {isFinal && <span className={styles.statusFinal}>{game.detailedStatus || 'FINAL'}</span>}
        {isScheduled && (
          <span className={styles.statusScheduled}>
            {formatTime ? formatTime(game.startTime) : ''}
          </span>
        )}
        {!['live','final','scheduled'].includes(game.status) && (
          <span className={styles.statusOther}>{game.detailedStatus}</span>
        )}
        <span className={styles.venue}>{game.venue}</span>
      </div>

      {/* Teams & Scores */}
      <div className={styles.teams}>
        {/* Away */}
        <div className={`${styles.teamRow} ${(awayWin || awayLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            <span className={styles.teamAbbrev}>{game.away.abbrev}</span>
            <span className={styles.teamName}>{game.away.name}</span>
            {game.away.record && <span className={styles.teamRecord}>{game.away.record}</span>}
          </div>
          {(isLive || isFinal) && (
            <div className={styles.scoreBox}>
              <span className={styles.score}>{game.away.score ?? ''}</span>
              {(isLive || isFinal) && game.away.hits !== null && (
                <span className={styles.hits}>{game.away.hits}H</span>
              )}
            </div>
          )}
        </div>

        <div className={styles.teamDivider}></div>

        {/* Home */}
        <div className={`${styles.teamRow} ${(homeWin || homeLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            <span className={styles.teamAbbrev}>{game.home.abbrev}</span>
            <span className={styles.teamName}>{game.home.name}</span>
            {game.home.record && <span className={styles.teamRecord}>{game.home.record}</span>}
          </div>
          {(isLive || isFinal) && (
            <div className={styles.scoreBox}>
              <span className={styles.score}>{game.home.score ?? ''}</span>
              {(isLive || isFinal) && game.home.hits !== null && (
                <span className={styles.hits}>{game.home.hits}H</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Live count + bases */}
      {isLive && (
        <div className={styles.liveDetails}>
          <div className={styles.count}>
            {game.balls}-{game.strikes} · {game.outs} OUT{game.outs !== 1 ? 'S' : ''}
          </div>
          <BaseDiamond first={game.onFirst} second={game.onSecond} third={game.onThird} />
        </div>
      )}

      {/* Probable pitchers */}
      {isScheduled && (game.away.probablePitcher || game.home.probablePitcher) && (
        <div className={styles.pitchers}>
          <div className={styles.pitcher}>
            <span className={styles.pitcherTeam}>{game.away.abbrev}</span>
            <span className={styles.pitcherName}>{game.away.probablePitcher?.name || 'TBD'}</span>
            {game.away.probablePitcher?.era && <span className={styles.pitcherEra}>{game.away.probablePitcher.era} ERA</span>}
          </div>
          <span className={styles.pitcherVs}>vs</span>
          <div className={styles.pitcher}>
            <span className={styles.pitcherTeam}>{game.home.abbrev}</span>
            <span className={styles.pitcherName}>{game.home.probablePitcher?.name || 'TBD'}</span>
            {game.home.probablePitcher?.era && <span className={styles.pitcherEra}>{game.home.probablePitcher.era} ERA</span>}
          </div>
        </div>
      )}

      {/* Weather */}
      {isScheduled && game.weather && (
        <div className={styles.weather}>{game.weather}</div>
      )}

      {/* Analyze button */}
      <button className={styles.analyzeBtn} onClick={handleAnalyze}>
        ⚡ Analyze Matchup
      </button>
    </div>
  );
}

function BaseDiamond({ first, second, third }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" className="base-diamond">
      {/* Diamond outline */}
      <rect x="13" y="1" width="10" height="10" rx="1" transform="rotate(45 18 6)"
        fill={second ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
      <rect x="1" y="13" width="10" height="10" rx="1" transform="rotate(45 6 18)"
        fill={third ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
      <rect x="25" y="13" width="10" height="10" rx="1" transform="rotate(45 30 18)"
        fill={first ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
    </svg>
  );
}
