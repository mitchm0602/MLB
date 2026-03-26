import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import styles from '../styles/Record.module.css';

function fmtDate(ds) {
  return new Date(ds + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function winPct(w, l) {
  const total = w + l;
  if (!total) return '—';
  return ((w / total) * 100).toFixed(1) + '%';
}

export default function Record() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [grading, setGrading] = useState(false);
  const [gradedCount, setGradedCount] = useState(null);

  const load = () => {
    setLoading(true);
    fetch('/api/picks')
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    // Auto-grade on page load then load record
    fetch('/api/grade', { method: 'POST' })
      .then(() => load())
      .catch(() => load());
  }, []);

  const runGrading = async () => {
    setGrading(true);
    const res = await fetch('/api/grade', { method: 'POST' });
    const d = await res.json();
    setGradedCount(d.graded);
    setGrading(false);
    load();
  };

  if (loading) return (
    <div className={styles.app}>
      <div className={styles.loading}><span className={styles.loader}></span> Loading record...</div>
    </div>
  );

  const stats = data?.stats || { wins: 0, losses: 0, pushes: 0, total: 0, pending: 0 };
  const byDate = data?.byDate || {};
  const sortedDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));

  // Overall spread vs total breakdown
  const allPicks = data?.picks || [];
  const spreadPicks = allPicks.filter(p => p.pickType === 'spread' && p.result && !['pending','pass'].includes(p.result));
  const totalPicks = allPicks.filter(p => p.pickType === 'total' && p.result && !['pending','pass'].includes(p.result));
  const spreadW = spreadPicks.filter(p => p.result === 'win').length;
  const spreadL = spreadPicks.filter(p => p.result === 'loss').length;
  const totalW = totalPicks.filter(p => p.result === 'win').length;
  const totalL = totalPicks.filter(p => p.result === 'loss').length;

  // Best confidence tier breakdown
  const tier8plus = allPicks.filter(p => p.confidence >= 8 && !['pending','pass'].includes(p.result));
  const tier6to7 = allPicks.filter(p => p.confidence >= 6 && p.confidence < 8 && !['pending','pass'].includes(p.result));
  const tier8W = tier8plus.filter(p => p.result === 'win').length;
  const tier6W = tier6to7.filter(p => p.result === 'win').length;

  return (
    <>
      <Head>
        <title>Record — MLB Edge</title>
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
                <Link href="/best-bets" className={styles.navLink}>Best Bets</Link>
                <span className={styles.navActive}>Record</span>
              </nav>
            </div>
            <div className={styles.headerRight}>
              <button className={styles.gradeBtn} onClick={runGrading} disabled={grading}>
                {grading ? <><span className={styles.loader}></span> Grading...</> : '↻ Grade Results'}
              </button>
              {gradedCount !== null && <span className={styles.gradedMsg}>Graded {gradedCount} picks</span>}
            </div>
          </div>
        </header>

        <main className={styles.main}>
          {/* Overall record banner */}
          <div className={styles.overallBanner}>
            <div className={styles.overallRecord}>
              <span className={styles.overallW}>{stats.wins}</span>
              <span className={styles.overallDash}>-</span>
              <span className={styles.overallL}>{stats.losses}</span>
              {stats.pushes > 0 && <span className={styles.overallP}>-{stats.pushes}</span>}
            </div>
            <div className={styles.overallLabel}>ALL TIME RECORD</div>
            <div className={styles.overallPct}>{winPct(stats.wins, stats.losses)} WIN RATE</div>
            {stats.pending > 0 && <div className={styles.overallPending}>{stats.pending} picks pending</div>}
          </div>

          {/* Breakdown stats */}
          <div className={styles.statGrid}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>SPREAD</div>
              <div className={styles.statRecord}><span className={styles.w}>{spreadW}</span>-<span className={styles.l}>{spreadL}</span></div>
              <div className={styles.statPct}>{winPct(spreadW, spreadL)}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>O/U TOTAL</div>
              <div className={styles.statRecord}><span className={styles.w}>{totalW}</span>-<span className={styles.l}>{totalL}</span></div>
              <div className={styles.statPct}>{winPct(totalW, totalL)}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>CONF 8-10</div>
              <div className={styles.statRecord}><span className={styles.w}>{tier8W}</span>-<span className={styles.l}>{tier8plus.length - tier8W}</span></div>
              <div className={styles.statPct}>{winPct(tier8W, tier8plus.length - tier8W)}</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>CONF 6-7</div>
              <div className={styles.statRecord}><span className={styles.w}>{tier6W}</span>-<span className={styles.l}>{tier6to7.length - tier6W}</span></div>
              <div className={styles.statPct}>{winPct(tier6W, tier6to7.length - tier6W)}</div>
            </div>
          </div>

          {/* Daily breakdown */}
          {sortedDates.length === 0 && (
            <div className={styles.empty}>
              <div className={styles.emptyIcon}>📊</div>
              <div className={styles.emptyTitle}>No record yet</div>
              <div className={styles.emptyText}>Picks are saved automatically when the scoreboard analyzes games. Once games finish, click "Grade Results" to update the record.</div>
              <Link href="/scoreboard" className={styles.goBtn}>→ Go to Scoreboard</Link>
            </div>
          )}

          {sortedDates.map(d => {
            const dayPicks = byDate[d].filter(p => !['pending','pass'].includes(p.result) || p.result === 'pending');
            const dayW = dayPicks.filter(p => p.result === 'win').length;
            const dayL = dayPicks.filter(p => p.result === 'loss').length;
            const dayPush = dayPicks.filter(p => p.result === 'push').length;
            const dayPend = dayPicks.filter(p => p.result === 'pending').length;

            return (
              <div key={d} className={styles.daySection}>
                <div className={styles.dayHeader}>
                  <span className={styles.dayDate}>{fmtDate(d)}</span>
                  <span className={styles.dayRecord}>
                    <span className={styles.w}>{dayW}W</span>
                    {' - '}
                    <span className={styles.l}>{dayL}L</span>
                    {dayPush > 0 && <span className={styles.push}> - {dayPush}P</span>}
                    {dayPend > 0 && <span className={styles.pend}> ({dayPend} pending)</span>}
                  </span>
                  <span className={styles.dayPct}>{winPct(dayW, dayL)}</span>
                </div>
                <div className={styles.dayPicks}>
                  {dayPicks.sort((a,b) => (b.confidence||0) - (a.confidence||0)).map(pick => (
                    <DayPickRow key={`${pick.gameId}-${pick.pickType}`} pick={pick} />
                  ))}
                </div>
              </div>
            );
          })}
        </main>
      </div>
    </>
  );
}

function DayPickRow({ pick }) {
  const resultClass = pick.result === 'win' ? styles.win : pick.result === 'loss' ? styles.loss : pick.result === 'push' ? styles.push : styles.pending;
  const resultLabel = pick.result === 'win' ? '✓ WIN' : pick.result === 'loss' ? '✗ LOSS' : pick.result === 'push' ? 'PUSH' : 'PENDING';

  return (
    <div className={styles.pickRow}>
      <div className={styles.pickMatchup}>
        <span className={styles.teamAbbrev}>{pick.awayAbbrev}</span>
        <span className={styles.at}>@</span>
        <span className={styles.teamAbbrev}>{pick.homeAbbrev}</span>
      </div>
      <div className={styles.pickDesc}>
        <span className={styles.pickType}>{pick.pickType === 'spread' ? 'SPREAD' : 'TOTAL'}</span>
        <span className={styles.pickVal}>{pick.pick} {pick.line}</span>
      </div>
      <div className={styles.pickConf} style={{ color: pick.confidence >= 8 ? '#4afa9a' : pick.confidence >= 6 ? '#e8f94a' : '#f9a83a' }}>
        {pick.confidence}/10
      </div>
      <div className={`${styles.pickResult} ${resultClass}`}>{resultLabel}</div>
      {pick.result !== 'pending' && pick.actualAway != null && (
        <div className={styles.finalScore}>{pick.awayAbbrev} {pick.actualAway}–{pick.homeAbbrev} {pick.actualHome}</div>
      )}
    </div>
  );
}
