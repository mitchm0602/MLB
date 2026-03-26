import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/BestBets.module.css';

function confidenceColor(c) {
  if (c >= 8) return '#4afa9a';
  if (c >= 6) return '#e8f94a';
  if (c >= 4) return '#f9a83a';
  return '#ff4d4d';
}

function fmtDate(ds) {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

export default function BestBets() {
  const [picks, setPicks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [date, setDate] = useState(null);
  useEffect(() => {
    const now = new Date();
    setDate(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`);
  }, []);
  const [filter, setFilter] = useState('all'); // all | spread | total
  const [minConf, setMinConf] = useState(6);

  useEffect(() => {
    if (!date) return;
    setLoading(true);
    fetch(`/api/picks?date=${date}`)
      .then(r => r.json())
      .then(data => {
        setPicks(data.picks || []);
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [date]);

  const changeDate = (offset) => {
    const d = new Date(date + 'T12:00:00');
    d.setDate(d.getDate() + offset);
    setDate(d.toISOString().split('T')[0]);
  };

  const now = new Date();
  const todayLocal = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const isToday = date === todayLocal;

  // Filter + sort by confidence desc
  const filtered = picks
    .filter(p => filter === 'all' || p.pickType === filter)
    .filter(p => (p.confidence || 0) >= minConf)
    .filter(p => p.result !== 'pass')
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, 10);

  const pending = filtered.filter(p => p.result === 'pending').length;
  const wins = filtered.filter(p => p.result === 'win').length;
  const losses = filtered.filter(p => p.result === 'loss').length;

  return (
    <>
      <Head>
        <title>Best Bets — MLB Edge</title>
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⚾</text></svg>" />
      </Head>
      <div className={styles.app}>
        <header className={styles.header}>
          <div className={styles.headerInner}>
            <div className={styles.headerLeft}>
              <Link href="/scoreboard" className={styles.logo}>
                <span>⚾</span>
                <div>
                  <div className={styles.logoTitle}>MLB EDGE</div>
                  <div className={styles.logoSub}>AI Betting Assistant</div>
                </div>
              </Link>
              <nav className={styles.nav}>
                <Link href="/scoreboard" className={styles.navLink}>Scoreboard</Link>
                <span className={styles.navActive}>Best Bets</span>
                <Link href="/record" className={styles.navLink}>Record</Link>
              </nav>
            </div>
          </div>
        </header>

        <main className={styles.main}>
          {/* Date nav */}
          <div className={styles.dateNav}>
            <button className={styles.dateBtn} onClick={() => changeDate(-1)}>←</button>
            <div className={styles.dateCenter}>
              <div className={styles.dateLabel}>{fmtDate(date)}</div>
              {!isToday && <button className={styles.todayBtn} onClick={() => setDate(new Date().toISOString().split('T')[0])}>Today</button>}
            </div>
            <button className={styles.dateBtn} onClick={() => changeDate(1)}>→</button>
          </div>

          {/* Filters */}
          <div className={styles.filters}>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>TYPE</span>
              {['all','spread','total'].map(f => (
                <button key={f} className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`} onClick={() => setFilter(f)}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>MIN CONF</span>
              {[5,6,7,8].map(n => (
                <button key={n} className={`${styles.filterBtn} ${minConf === n ? styles.filterActive : ''}`} onClick={() => setMinConf(n)}>
                  {n}+
                </button>
              ))}
            </div>
            {(wins + losses) > 0 && (
              <div className={styles.dayRecord}>
                <span className={styles.recordWin}>{wins}W</span>
                <span className={styles.recordSep}>-</span>
                <span className={styles.recordLoss}>{losses}L</span>
                {pending > 0 && <span className={styles.recordPend}>({pending} pending)</span>}
              </div>
            )}
          </div>

          {loading && <div className={styles.loading}><span className={styles.loader}></span> Loading picks...</div>}
          {error && <div className={styles.errorBar}>{error}</div>}

          {!loading && filtered.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>🎯</div>
              <div className={styles.emptyTitle}>No picks yet for {fmtDate(date)}</div>
              <div className={styles.emptyText}>
                {isToday
                  ? 'Go to the Scoreboard — picks are generated automatically as games load.'
                  : 'No picks were saved for this date.'}
              </div>
              {isToday && <Link href="/scoreboard" className={styles.goBtn}>→ Go to Scoreboard</Link>}
            </div>
          )}

          {filtered.length > 0 && (
            <div className={styles.picksList}>
              {filtered.map((pick, i) => (
                <PickCard key={`${pick.gameId}-${pick.pickType}`} pick={pick} rank={i + 1} />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  );
}

function PickCard({ pick, rank }) {
  const color = confidenceColor(pick.confidence);
  const isSpread = pick.pickType === 'spread';
  const resultClass = pick.result === 'win' ? styles.win : pick.result === 'loss' ? styles.loss : pick.result === 'push' ? styles.push : styles.pending;
  const resultLabel = pick.result === 'win' ? 'WIN ✓' : pick.result === 'loss' ? 'LOSS ✗' : pick.result === 'push' ? 'PUSH' : 'PENDING';

  return (
    <div className={`${styles.pickCard} ${pick.result !== 'pending' ? styles[pick.result] : ''}`}>
      <div className={styles.rankBadge} style={{ color, borderColor: color }}>#{rank}</div>

      <div className={styles.pickMain}>
        <div className={styles.pickTop}>
          <div className={styles.matchup}>
            <span className={styles.awayTeam}>{pick.awayAbbrev || pick.awayTeam}</span>
            <span className={styles.atSign}>@</span>
            <span className={styles.homeTeam}>{pick.homeAbbrev || pick.homeTeam}</span>
          </div>
          <div className={styles.pickTypeTag}>{isSpread ? 'SPREAD' : 'TOTAL'}</div>
        </div>

        <div className={styles.pickValue}>
          {isSpread ? (
            <span>{pick.pick} <span className={styles.pickLine}>{pick.line}</span></span>
          ) : (
            <span>{pick.pick} <span className={styles.pickLine}>{pick.line}</span></span>
          )}
        </div>

        {pick.edge && <div className={styles.pickEdge}>{pick.edge}</div>}
      </div>

      <div className={styles.pickRight}>
        <div className={styles.confScore} style={{ color }}>{pick.confidence}<span className={styles.confOf}>/10</span></div>
        <div className={styles.confDots}>
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={styles.dot} style={{ background: i < pick.confidence ? color : 'var(--border2)' }} />
          ))}
        </div>
        <div className={`${styles.result} ${resultClass}`}>{resultLabel}</div>
        {pick.result !== 'pending' && pick.actualAway != null && (
          <div className={styles.finalScore}>{pick.awayAbbrev} {pick.actualAway} — {pick.homeAbbrev} {pick.actualHome}</div>
        )}
      </div>
    </div>
  );
}
