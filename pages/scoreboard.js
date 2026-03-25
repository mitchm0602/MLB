import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Scoreboard.module.css';

const REFRESH_INTERVAL = 30000;

// Fuzzy match MLB API team name to Odds API team name
function matchTeams(mlbName, oddsGames) {
  if (!mlbName || !oddsGames.length) return null;
  const norm = s => s.toLowerCase().replace(/[^a-z]/g, '');
  const mlbNorm = norm(mlbName);
  for (const og of oddsGames) {
    if (norm(og.homeTeam) === mlbNorm || norm(og.awayTeam) === mlbNorm) return og;
    // Match on last word (city names differ: "Chi. Cubs" vs "Chicago Cubs")
    const mlbLast = mlbName.split(' ').pop().toLowerCase();
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

    // Fetch scores + odds in parallel (odds only for today/future)
    const [scoresRes, oddsRes] = await Promise.allSettled([
      fetch(`/api/scores?date=${targetDate}`).then(r => r.json()),
      isToday ? fetch('/api/odds').then(r => r.json()) : Promise.resolve({ odds: [] }),
    ]);

    if (scoresRes.status === 'fulfilled' && !scoresRes.value.error) {
      const fetchedGames = scoresRes.value.games || [];
      setFetchedAt(scoresRes.value.fetchedAt);
      setHasLive(fetchedGames.some(g => g.status === 'live'));

      // Merge odds into games
      if (oddsRes.status === 'fulfilled') {
        const oddsData = oddsRes.value;
        if (oddsData.error) setOddsError(oddsData.error);
        else setOddsError('');
        if (oddsData.remaining) setOddsRemaining(oddsData.remaining);

        const map = {};
        for (const game of fetchedGames) {
          const match = matchTeams(game.home.name, oddsData.odds || []);
          if (match) {
            // Figure out which side is home in the odds data
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

  useEffect(() => {
    setLoading(true);
    fetchAll(date);
  }, [date, fetchAll]);

  useEffect(() => {
    timerRef.current = setInterval(() => {
      fetchAll(date);
      setCountdown(REFRESH_INTERVAL / 1000);
    }, REFRESH_INTERVAL);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => (prev <= 1 ? REFRESH_INTERVAL / 1000 : prev - 1));
    }, 1000);
    return () => {
      clearInterval(timerRef.current);
      clearInterval(countdownRef.current);
    };
  }, [date, fetchAll]);

  const changeDate = (offset) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split('T')[0]);
  };

  const formatDate = (dateStr) => {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  };

  const formatTime = (iso) => {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
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
              {oddsRemaining && (
                <span className={styles.oddsRemaining}>{oddsRemaining} odds calls left</span>
              )}
              <button className={styles.refreshBtn} onClick={() => { setLoading(true); fetchAll(date); }}>↻</button>
            </div>
          </div>
        </header>

        <main className={styles.main}>
          <div className={styles.dateNav}>
            <button className={styles.dateBtn} onClick={() => changeDate(-1)}>←</button>
            <div className={styles.dateCenter}>
              <div className={styles.dateLabel}>{formatDate(date)}</div>
              {!isToday && (
                <button className={styles.todayBtn} onClick={() => setDate(new Date().toISOString().split('T')[0])}>
                  Back to Today
                </button>
              )}
            </div>
            <button className={styles.dateBtn} onClick={() => changeDate(1)}>→</button>
          </div>

          {fetchedAt && (
            <div className={styles.fetchedAt}>Last updated: {new Date(fetchedAt).toLocaleTimeString()}</div>
          )}

          {oddsError && !oddsError.includes('not configured') && (
            <div className={styles.oddsWarning}>⚠ Odds unavailable: {oddsError}</div>
          )}
          {oddsError.includes('not configured') && (
            <div className={styles.oddsWarning}>
              ⚠ Add ODDS_API_KEY to Vercel env vars to enable live betting lines —{' '}
              <a href="https://the-odds-api.com" target="_blank" rel="noreferrer" className={styles.oddsLink}>
                get a free key at the-odds-api.com
              </a>
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

          {liveGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}><span className={styles.liveDot}></span> LIVE — {liveGames.length} GAME{liveGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>
                {liveGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}
              </div>
            </section>
          )}
          {scheduledGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>SCHEDULED — {scheduledGames.length} GAME{scheduledGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>
                {scheduledGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}
              </div>
            </section>
          )}
          {finalGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>FINAL — {finalGames.length} GAME{finalGames.length !== 1 ? 'S' : ''}</div>
              <div className={styles.gameGrid}>
                {finalGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}
              </div>
            </section>
          )}
          {otherGames.length > 0 && (
            <section>
              <div className={styles.sectionLabel}>OTHER</div>
              <div className={styles.gameGrid}>
                {otherGames.map(g => <GameCard key={g.id} game={g} odds={oddsMap[g.id]} formatTime={formatTime} />)}
              </div>
            </section>
          )}
        </main>
      </div>
    </>
  );
}

function GameCard({ game, odds, formatTime }) {
  const isLive = game.status === 'live';
  const isFinal = game.status === 'final';
  const isScheduled = game.status === 'scheduled';

  const awayWin = isFinal && game.away.score > game.home.score;
  const homeWin = isFinal && game.home.score > game.away.score;
  const awayLeads = isLive && game.away.score > game.home.score;
  const homeLeads = isLive && game.home.score > game.away.score;

  const awayFavored = odds?.favored === 'away';
  const homeFavored = odds?.favored === 'home';

  const handleAnalyze = () => {
    const spread = odds?.spread?.homePoint != null ? String(odds.spread.homePoint) : '';
    const url = `/?away=${encodeURIComponent(game.away.name)}&home=${encodeURIComponent(game.home.name)}&spread=${encodeURIComponent(spread)}`;
    window.location.href = url;
  };

  return (
    <div className={`${styles.gameCard} ${isLive ? styles.liveCard : ''}`}>
      {/* Top row: status + venue */}
      <div className={styles.cardTop}>
        {isLive && (
          <span className={styles.statusLive}>
            <span className={styles.liveDotSmall}></span>
            {game.inningHalf === 'Top' ? '▲' : '▼'} {game.inning}
          </span>
        )}
        {isFinal && <span className={styles.statusFinal}>{game.detailedStatus || 'FINAL'}</span>}
        {isScheduled && <span className={styles.statusScheduled}>{formatTime(game.startTime)}</span>}
        {!['live','final','scheduled'].includes(game.status) && (
          <span className={styles.statusOther}>{game.detailedStatus}</span>
        )}
        <span className={styles.venue}>{game.venue}</span>
      </div>

      {/* Teams + Scores + Lines */}
      <div className={styles.teams}>
        {/* Away row */}
        <div className={`${styles.teamRow} ${(awayWin || awayLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            {awayFavored && <span className={styles.favoredDot}>◆</span>}
            <span className={styles.teamAbbrev}>{game.away.abbrev}</span>
            <span className={styles.teamName}>{game.away.name}</span>
            {game.away.record && <span className={styles.teamRecord}>{game.away.record}</span>}
          </div>
          <div className={styles.teamRight}>
            {odds && (
              <div className={styles.oddsCol}>
                <span className={styles.oddsML}>{formatOdds(odds.moneyline.away)}</span>
                <span className={styles.oddsSpread}>
                  {odds.spread.awayPoint != null ? formatOdds(odds.spread.awayPoint) : '—'}
                </span>
              </div>
            )}
            {(isLive || isFinal) && (
              <div className={styles.scoreBox}>
                <span className={styles.score}>{game.away.score ?? ''}</span>
                {game.away.hits !== null && <span className={styles.hits}>{game.away.hits}H</span>}
              </div>
            )}
          </div>
        </div>

        {/* Divider with O/U */}
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

        {/* Home row */}
        <div className={`${styles.teamRow} ${(homeWin || homeLeads) ? styles.winner : ''}`}>
          <div className={styles.teamInfo}>
            {homeFavored && <span className={styles.favoredDot}>◆</span>}
            <span className={styles.teamAbbrev}>{game.home.abbrev}</span>
            <span className={styles.teamName}>{game.home.name}</span>
            {game.home.record && <span className={styles.teamRecord}>{game.home.record}</span>}
          </div>
          <div className={styles.teamRight}>
            {odds && (
              <div className={styles.oddsCol}>
                <span className={styles.oddsML}>{formatOdds(odds.moneyline.home)}</span>
                <span className={styles.oddsSpread}>
                  {odds.spread.homePoint != null ? formatOdds(odds.spread.homePoint) : '—'}
                </span>
              </div>
            )}
            {(isLive || isFinal) && (
              <div className={styles.scoreBox}>
                <span className={styles.score}>{game.home.score ?? ''}</span>
                {game.home.hits !== null && <span className={styles.hits}>{game.home.hits}H</span>}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Odds header labels */}
      {odds && (
        <div className={styles.oddsHeader}>
          <span></span>
          <span className={styles.oddsHeaderLabel}>ML</span>
          <span className={styles.oddsHeaderLabel}>SPREAD</span>
          {(isLive || isFinal) && <span className={styles.oddsHeaderLabel}>SCORE</span>}
        </div>
      )}

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
          </div>
          <span className={styles.pitcherVs}>vs</span>
          <div className={styles.pitcher}>
            <span className={styles.pitcherTeam}>{game.home.abbrev}</span>
            <span className={styles.pitcherName}>{game.home.probablePitcher?.name || 'TBD'}</span>
          </div>
        </div>
      )}

      {game.weather && isScheduled && (
        <div className={styles.weather}>{game.weather}</div>
      )}

      <button className={styles.analyzeBtn} onClick={handleAnalyze}>
        ⚡ Analyze Matchup {odds?.spread?.homePoint != null ? `(${game.home.abbrev} ${formatOdds(odds.spread.homePoint)})` : ''}
      </button>
    </div>
  );
}

function BaseDiamond({ first, second, third }) {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36">
      <rect x="13" y="1" width="10" height="10" rx="1" transform="rotate(45 18 6)"
        fill={second ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
      <rect x="1" y="13" width="10" height="10" rx="1" transform="rotate(45 6 18)"
        fill={third ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
      <rect x="25" y="13" width="10" height="10" rx="1" transform="rotate(45 30 18)"
        fill={first ? '#e8f94a' : 'transparent'} stroke="#4a5568" strokeWidth="1.5" />
    </svg>
  );
}
