'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'

const TABS = ['Check-in', 'Bracket', 'Scores', 'Roasts', 'Photos']

export default function HostPage() {
  const router = useRouter()
  const [tab, setTab] = useState('Check-in')
  const [cheeses, setCheeses] = useState([])
  const [attendees, setAttendees] = useState([])
  const [matches, setMatches] = useState([])
  const [ratings, setRatings] = useState([])
  const [photos, setPhotos] = useState([])
  const [roasts, setRoasts] = useState([])
  const [round, setRound] = useState(1)
  const [loading, setLoading] = useState(true)
  const [advancing, setAdvancing] = useState(false)
  const [confirmAdvance, setConfirmAdvance] = useState(false)
  const [toast, setToast] = useState('')
  const [searchCheese, setSearchCheese] = useState('')

  useEffect(() => { fetchAll() }, [])

  // Real-time subscription for live updates
  useEffect(() => {
    const sub = supabase
      .channel('host-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendees' }, () => fetchAttendees())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cheeses' }, () => fetchCheeses())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ratings' }, () => fetchRatings())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, () => fetchPhotos())
      .subscribe()
    return () => supabase.removeChannel(sub)
  }, [])

  async function fetchAll() {
    setLoading(true)
    await Promise.all([fetchCheeses(), fetchAttendees(), fetchRatings(), fetchPhotos()])
    setLoading(false)
  }

  async function fetchCheeses() {
    const { data } = await supabase.from('cheeses').select('*').order('id')
    if (data) setCheeses(data)
  }

  async function fetchAttendees() {
    const { data } = await supabase.from('attendees').select('*').order('checked_in_at', { ascending: false })
    if (data) setAttendees(data)
  }

  async function fetchRatings() {
    const { data } = await supabase
      .from('ratings')
      .select('*, cheeses(name), attendees(name)')
      .order('submitted_at', { ascending: false })
    if (data) {
      setRatings(data)
      setRoasts(data.filter(r => r.roast))
    }
  }

  async function fetchPhotos() {
    const { data } = await supabase.from('photos').select('*').order('uploaded_at', { ascending: false })
    if (data) setPhotos(data)
  }

  async function activateCheese(id) {
    await supabase.from('cheeses').update({ active: true }).eq('id', id)
    showToast('Cheese activated!')
    fetchCheeses()
  }

  async function deactivateCheese(id) {
    await supabase.from('cheeses').update({ active: false }).eq('id', id)
    fetchCheeses()
  }

  async function markDuplicate(id) {
    await supabase.from('cheeses').update({ active: false, notes: 'DUPLICATE' }).eq('id', id)
    showToast('Marked as duplicate')
    fetchCheeses()
  }

  async function advanceRound() {
    if (!confirmAdvance) { setConfirmAdvance(true); return }
    setAdvancing(true)
    setConfirmAdvance(false)

    try {
      // Get all active cheeses in current round
      const activeCheeses = cheeses.filter(c => c.active && c.round === round)

      // For each cheese, compute average score
      const scored = activeCheeses.map(cheese => {
        const cheeseRatings = ratings.filter(r => r.cheese_id === cheese.id)
        if (!cheeseRatings.length) return { ...cheese, avg: 0, ratingCount: 0 }
        const avg = cheeseRatings.reduce((sum, r) => sum + r.dt_er_score + r.vc_score - (r.retire ? 3 : 0), 0) / cheeseRatings.length
        return { ...cheese, avg, ratingCount: cheeseRatings.length }
      })

      // Pair them up and pick winners
      const newRound = round + 1
      const pairs = []
      for (let i = 0; i < scored.length - 1; i += 2) {
        const a = scored[i], b = scored[i + 1]
        const winner = a.avg >= b.avg ? a : b
        const loser = a.avg >= b.avg ? b : a
        pairs.push({ winner, loser })

        // Insert match record
        await supabase.from('bracket_matches').insert({
          round,
          cheese_a: a.id,
          cheese_b: b.id,
          score_a: a.avg.toFixed(2),
          score_b: b.avg.toFixed(2),
          winner_id: winner.id,
          rating_count_a: a.ratingCount,
          rating_count_b: b.ratingCount,
        })

        // Advance winner
        await supabase.from('cheeses').update({ round: newRound, active: true }).eq('id', winner.id)
        // Eliminate loser
        await supabase.from('cheeses').update({ active: false, eliminated_round: round }).eq('id', loser.id)

        // Promote eliminated pair to judge role
        if (loser.brought_by) {
          await supabase.from('attendees').update({ role: 'judge' }).eq('own_cheese_id', loser.id)
        }
      }

      // Handle bye for odd cheese count
      if (scored.length % 2 !== 0) {
        const bye = scored[scored.length - 1]
        await supabase.from('cheeses').update({ round: newRound, active: true }).eq('id', bye.id)
        showToast(`${bye.name} gets a bye!`)
      }

      setRound(newRound)
      showToast(`Round ${round} closed! Round ${newRound} starting.`)
      fetchAll()
    } catch (e) {
      console.error(e)
      showToast('Error advancing round — check console')
    } finally {
      setAdvancing(false)
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  // Stats
  const activeCheeses = cheeses.filter(c => c.active && c.round === round)
  const pendingCheeses = cheeses.filter(c => !c.active && !c.eliminated_round)
  const totalRatings = ratings.length
  const ratingsThisRound = ratings.filter(r => {
    const cheese = cheeses.find(c => c.id === r.cheese_id)
    return cheese?.round === round
  }).length
  const expectedRatings = activeCheeses.length * 2
  const submissionPct = expectedRatings > 0 ? Math.min(100, Math.round((ratingsThisRound / expectedRatings) * 100)) : 0

  const filteredCheeses = cheeses.filter(c =>
    !searchCheese || c.name.toLowerCase().includes(searchCheese.toLowerCase())
  )

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--cream)' }}>
      <span className="spin-slow" style={{ fontSize:'2rem' }}>🥯</span>
    </div>
  )

  return (
    <main style={{ minHeight:'100vh', background:'var(--cream)' }}>
      {/* Host header */}
      <div style={{ background:'var(--sesame)', color:'var(--cream)', padding:'1.25rem 1.5rem', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <p className="font-mono" style={{ fontSize:'0.6rem', letterSpacing:'0.12em', textTransform:'uppercase', opacity:0.6, marginBottom:'0.2rem' }}>Host Dashboard</p>
          <h1 className="font-display" style={{ fontSize:'1.3rem', fontWeight:900, color:'var(--cream)' }}>🥯 Bagel Bowl</h1>
        </div>
        <span className="badge" style={{ background:'var(--bagel-light)', color:'var(--sesame)', fontSize:'0.65rem' }}>
          Round {round}
        </span>
      </div>

      {/* Stats row */}
      <div style={{ background:'var(--white-cheese)', borderBottom:'1px solid var(--border)', padding:'1rem 1.25rem', display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'0.5rem' }}>
        {[
          { label:'Checked in', value: attendees.length },
          { label:'Active cheeses', value: activeCheeses.length },
          { label:'Ratings in', value: `${submissionPct}%` },
          { label:'Photos', value: photos.length },
        ].map(s => (
          <div key={s.label} style={{ textAlign:'center' }}>
            <div className="font-display" style={{ fontSize:'1.4rem', fontWeight:900, color:'var(--bagel)' }}>{s.value}</div>
            <div className="font-mono" style={{ fontSize:'0.58rem', letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--sesame-mid)' }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'1px solid var(--border)', background:'var(--white-cheese)', overflowX:'auto' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex:'0 0 auto', padding:'0.75rem 1rem',
              fontFamily:'DM Mono,monospace', fontSize:'0.65rem', letterSpacing:'0.08em', textTransform:'uppercase',
              border:'none', borderBottom: tab === t ? '2px solid var(--bagel)' : '2px solid transparent',
              background:'transparent', color: tab === t ? 'var(--bagel)' : 'var(--sesame-mid)',
              cursor:'pointer', transition:'all 0.15s',
            }}
          >{t}</button>
        ))}
      </div>

      <div style={{ maxWidth:600, margin:'0 auto', padding:'1.5rem 1.25rem 4rem' }}>

        {/* CHECK-IN TAB */}
        {tab === 'Check-in' && (
          <div>
            <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem', alignItems:'center' }}>
              <input
                className="input"
                style={{ flex:1 }}
                placeholder="Search cheeses..."
                value={searchCheese}
                onChange={e => setSearchCheese(e.target.value)}
              />
              {pendingCheeses.length > 0 && (
                <span className="badge badge-poppy">{pendingCheeses.length} pending</span>
              )}
            </div>

            {filteredCheeses.map(cheese => (
              <div
                key={cheese.id}
                className="card-sm"
                style={{
                  marginBottom:'0.5rem', display:'flex', alignItems:'center', gap:'0.75rem',
                  borderLeft: cheese.notes === 'DUPLICATE' ? '3px solid var(--poppy)' :
                              cheese.active ? '3px solid var(--chive)' : '3px solid var(--cream-darker)'
                }}
              >
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:'0.9rem', fontWeight:600 }}>{cheese.name}</p>
                  <p className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>
                    {cheese.notes === 'DUPLICATE' ? '⚠️ Duplicate' :
                     cheese.active ? '✓ Active' :
                     cheese.eliminated_round ? `Eliminated R${cheese.eliminated_round}` : 'Pending activation'}
                  </p>
                </div>
                {!cheese.active && !cheese.eliminated_round && cheese.notes !== 'DUPLICATE' && (
                  <div style={{ display:'flex', gap:'0.35rem' }}>
                    <button
                      onClick={() => activateCheese(cheese.id)}
                      style={{ padding:'0.35rem 0.7rem', background:'var(--chive)', color:'#D4F0D4', border:'none', borderRadius:6, fontFamily:'DM Mono,monospace', fontSize:'0.62rem', cursor:'pointer' }}
                    >Activate</button>
                    <button
                      onClick={() => markDuplicate(cheese.id)}
                      style={{ padding:'0.35rem 0.7rem', background:'var(--cream-dark)', color:'var(--sesame-mid)', border:'1px solid var(--border)', borderRadius:6, fontFamily:'DM Mono,monospace', fontSize:'0.62rem', cursor:'pointer' }}
                    >Dupe</button>
                  </div>
                )}
                {cheese.active && (
                  <button
                    onClick={() => deactivateCheese(cheese.id)}
                    style={{ padding:'0.35rem 0.7rem', background:'var(--cream-dark)', color:'var(--sesame-mid)', border:'1px solid var(--border)', borderRadius:6, fontFamily:'DM Mono,monospace', fontSize:'0.62rem', cursor:'pointer' }}
                  >Remove</button>
                )}
              </div>
            ))}

            {/* Attendee list */}
            <div className="divider" style={{ marginTop:'1.5rem' }}>Attendees ({attendees.length})</div>
            {attendees.map(a => (
              <div key={a.id} className="card-sm" style={{ marginBottom:'0.4rem', display:'flex', alignItems:'center', gap:'0.5rem' }}>
                <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--cream-dark)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Playfair Display,serif', fontSize:'0.8rem', fontWeight:700, flexShrink:0 }}>
                  {a.name.charAt(0)}
                </div>
                <div style={{ flex:1 }}>
                  <p style={{ fontSize:'0.875rem', fontWeight:600 }}>{a.name}{a.partner_name ? ` & ${a.partner_name}` : ''}</p>
                  <p className="font-mono" style={{ fontSize:'0.58rem', color:'var(--sesame-mid)', textTransform:'uppercase', letterSpacing:'0.06em' }}>{a.role}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* BRACKET TAB */}
        {tab === 'Bracket' && (
          <div>
            {/* Submission progress warning */}
            <div
              className="card-sm"
              style={{
                marginBottom:'1rem',
                borderLeft: `3px solid ${submissionPct < 80 ? 'var(--poppy)' : 'var(--chive)'}`,
                background: submissionPct < 80 ? '#FFF5F5' : '#F0FFF0'
              }}
            >
              <p style={{ fontSize:'0.875rem', fontWeight:600, marginBottom:'0.25rem' }}>
                {submissionPct < 80 ? '⚠️' : '✓'} Submissions: {submissionPct}% ({ratingsThisRound}/{expectedRatings})
              </p>
              <p style={{ fontSize:'0.78rem', color:'var(--sesame-mid)' }}>
                {submissionPct < 80
                  ? 'Under 80% — consider waiting before advancing'
                  : 'Good to advance when ready'}
              </p>
            </div>

            {/* Active matches */}
            <p className="font-mono" style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)', marginBottom:'0.75rem' }}>
              Round {round} · {activeCheeses.length} active cheeses
            </p>

            {activeCheeses.map((cheese, i) => {
              const cheeseRatings = ratings.filter(r => r.cheese_id === cheese.id)
              const avg = cheeseRatings.length
                ? (cheeseRatings.reduce((s, r) => s + r.dt_er_score + r.vc_score - (r.retire ? 3 : 0), 0) / cheeseRatings.length).toFixed(1)
                : '—'
              return (
                <div key={cheese.id} className="card-sm" style={{ marginBottom:'0.5rem', display:'flex', alignItems:'center', gap:'0.75rem' }}>
                  <div style={{ width:36, height:36, borderRadius:'50%', background:'var(--bagel)', color:'var(--white-cheese)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Playfair Display,serif', fontWeight:900, fontSize:'0.85rem', flexShrink:0 }}>
                    {i + 1}
                  </div>
                  <div style={{ flex:1 }}>
                    <p style={{ fontSize:'0.9rem', fontWeight:600 }}>{cheese.name}</p>
                    <p className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>
                      {cheeseRatings.length} rating{cheeseRatings.length !== 1 ? 's' : ''} · avg {avg}
                    </p>
                  </div>
                  <span className="font-display" style={{ fontSize:'1.2rem', fontWeight:900, color:'var(--bagel)' }}>{avg}</span>
                </div>
              )
            })}

            {/* Advance button */}
            <div style={{ marginTop:'1.5rem' }}>
              {confirmAdvance && (
                <div className="card-sm" style={{ marginBottom:'0.75rem', background:'#FFF5F5', borderColor:'var(--poppy)' }}>
                  <p style={{ fontSize:'0.875rem', fontWeight:600, color:'var(--poppy)', marginBottom:'0.25rem' }}>Are you sure?</p>
                  <p style={{ fontSize:'0.78rem', color:'var(--sesame-mid)' }}>
                    This will close round {round}, eliminate losers, and open round {round + 1}. This cannot be undone.
                  </p>
                  <div style={{ display:'flex', gap:'0.5rem', marginTop:'0.75rem' }}>
                    <button onClick={() => setConfirmAdvance(false)} className="btn-secondary" style={{ fontSize:'0.8rem', padding:'0.5rem' }}>Cancel</button>
                    <button onClick={advanceRound} disabled={advancing} className="btn-danger" style={{ fontSize:'0.875rem', padding:'0.5rem 1rem' }}>
                      {advancing ? 'Advancing...' : 'Confirm →'}
                    </button>
                  </div>
                </div>
              )}
              {!confirmAdvance && (
                <button
                  className={submissionPct < 80 ? 'btn-secondary' : 'btn-danger'}
                  onClick={advanceRound}
                >
                  {submissionPct < 80
                    ? `⚠️ Close round anyway (${100 - submissionPct}% not submitted)`
                    : `Close round ${round} & advance winners →`}
                </button>
              )}
            </div>
          </div>
        )}

        {/* SCORES TAB */}
        {tab === 'Scores' && (
          <div>
            <p className="font-mono" style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)', marginBottom:'0.75rem' }}>
              All-time leaderboard
            </p>
            {cheeses
              .map(cheese => {
                const cr = ratings.filter(r => r.cheese_id === cheese.id)
                const avg = cr.length
                  ? cr.reduce((s, r) => s + r.dt_er_score + r.vc_score - (r.retire ? 3 : 0), 0) / cr.length
                  : 0
                return { ...cheese, avg, count: cr.length }
              })
              .filter(c => c.count > 0)
              .sort((a, b) => b.avg - a.avg)
              .map((cheese, i) => (
                <div key={cheese.id} style={{ display:'flex', alignItems:'center', gap:'0.75rem', padding:'0.75rem 0', borderBottom:'1px solid var(--border)' }}>
                  <span className="font-display" style={{ fontSize:'1.2rem', fontWeight:900, width:28, textAlign:'center', color: i === 0 ? '#C9A227' : i === 1 ? 'var(--sesame-mid)' : 'var(--sesame-light)' }}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
                  </span>
                  <div style={{ flex:1 }}>
                    <p style={{ fontSize:'0.9rem', fontWeight:600 }}>{cheese.name}</p>
                    <p className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>{cheese.count} ratings</p>
                  </div>
                  <span className="font-display" style={{ fontSize:'1.1rem', fontWeight:900, color:'var(--bagel)' }}>
                    {cheese.avg.toFixed(1)}
                  </span>
                </div>
              ))}
          </div>
        )}

        {/* ROASTS TAB */}
        {tab === 'Roasts' && (
          <div>
            <p className="font-mono" style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)', marginBottom:'0.75rem' }}>
              Live hot takes ({roasts.length})
            </p>
            {roasts.length === 0 && (
              <p style={{ color:'var(--sesame-mid)', fontStyle:'italic', fontSize:'0.875rem' }}>No roasts yet...</p>
            )}
            {roasts.map(r => (
              <div key={r.id} style={{ background:'var(--white-cheese)', border:'1px solid var(--border)', borderRadius:10, padding:'0.875rem', marginBottom:'0.5rem' }}>
                <p style={{ fontSize:'0.875rem', fontStyle:'italic', lineHeight:1.6 }}>"{r.roast}"</p>
                <p className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)', marginTop:'0.4rem' }}>
                  — {r.attendees?.name ?? 'Anonymous'} on <strong>{r.cheeses?.name ?? 'Unknown'}</strong>
                </p>
              </div>
            ))}
          </div>
        )}

        {/* PHOTOS TAB */}
        {tab === 'Photos' && (
          <div>
            <p className="font-mono" style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)', marginBottom:'0.75rem' }}>
              Party photos ({photos.length})
            </p>
            {photos.length === 0 && (
              <p style={{ color:'var(--sesame-mid)', fontStyle:'italic', fontSize:'0.875rem' }}>No photos uploaded yet</p>
            )}
            <div className="photo-grid">
              {photos.map((p, i) => (
                <a key={i} href={p.url} target="_blank" rel="noreferrer">
                  <img src={p.url} alt="" style={{ width:'100%', aspectRatio:'1', objectFit:'cover', borderRadius:8 }} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}
