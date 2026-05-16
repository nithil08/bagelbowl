'use client'
import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { getSavedSession, assignCheeses } from '../../lib/assignment'

const VC_LABELS = [
  'Acqui-hire bait','Lifestyle business','Angel round, maybe',
  'Pre-seed at best','Interesting pivot','Series A if lucky',
  'Series B potential','Growth stage','Pre-unicorn','🦄 Unicorn'
]
const DT_ER_LABELS = [
  '','Dollar Tree','Dollar Tree','Grocery Outlet','Trader Joe\'s','Trader Joe\'s',
  'Whole Foods','Whole Foods','Erewhon-adjacent','Full Erewhon','Erewhon flagship'
]

const ICEBREAKERS = [
  "Find someone whose cheese is in the same round as yours and convince them yours will win.",
  "Locate the person who rated their cheese a 10 on VC fundability. Debate them.",
  "Find the most controversial hot take on the roast feed and find who wrote it.",
  "Trade cream cheese origin stories with the nearest stranger.",
  "Find someone from a different school or company and get their unbiased take.",
  "Seek out whoever brought the weirdest cheese flavor and ask about their thought process.",
]

export default function RatePage() {
  const router = useRouter()
  const [session, setSession] = useState(null)
  const [cheeses, setCheeses] = useState([])           // [{id, name, ...}, ...]
  const [currentIdx, setCurrentIdx] = useState(0)
  const [ratings, setRatings] = useState({})           // cheeseId -> rating object
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [phase, setPhase] = useState('loading')        // loading | reveal | rating | photo | social | done
  const [uploadedPhotos, setUploadedPhotos] = useState([])
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [icebreaker, setIcebreaker] = useState('')
  const [toast, setToast] = useState('')
  const [timerActive, setTimerActive] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(30)
  const [canSubmit, setCanSubmit] = useState(false)
  const fileInputRef = useRef()
  const timerRef = useRef()

  useEffect(() => {
    const s = getSavedSession()
    if (!s?.attendeeId) { router.push('/'); return }
    setSession(s)
    loadAssignedCheeses(s.attendeeId)
    setIcebreaker(ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)])
  }, [])

  // 30-second minimum timer before submit activates
  useEffect(() => {
    if (phase === 'rating') {
      setCanSubmit(false)
      setSecondsLeft(30)
      setTimerActive(true)
    }
  }, [phase, currentIdx])

  useEffect(() => {
    if (!timerActive) return
    if (secondsLeft <= 0) { setCanSubmit(true); setTimerActive(false); return }
    timerRef.current = setTimeout(() => setSecondsLeft(s => s - 1), 1000)
    return () => clearTimeout(timerRef.current)
  }, [timerActive, secondsLeft])

  async function loadAssignedCheeses(attendeeId) {
    try {
      // Check existing assignment first
      const { data: attendee } = await supabase
        .from('attendees')
        .select('cheese_1, cheese_2, role')
        .eq('id', attendeeId)
        .single()

      let c1id = attendee?.cheese_1
      let c2id = attendee?.cheese_2

      // If no assignment yet, get one
      if (!c1id || !c2id) {
        const assigned = await assignCheeses(attendeeId)
        c1id = assigned.cheese1
        c2id = assigned.cheese2
      }

      // Fetch cheese details
      const { data: cheeseData } = await supabase
        .from('cheeses')
        .select('id, name, brought_by, partner_name')
        .in('id', [c1id, c2id].filter(Boolean))

      if (cheeseData?.length) {
        setCheeses(cheeseData)
        // Init rating state for each
        const initRatings = {}
        cheeseData.forEach(c => {
          initRatings[c.id] = { dtEr: 5, retire: null, vc: 5, roast: '' }
        })
        setRatings(initRatings)
        setPhase('reveal')
      } else {
        // No cheeses available (e.g. party not started yet)
        setPhase('waiting')
      }
    } catch (e) {
      console.error(e)
      setPhase('error')
    } finally {
      setLoading(false)
    }
  }

  function currentCheese() { return cheeses[currentIdx] }

  function updateRating(field, value) {
    const id = currentCheese()?.id
    if (!id) return
    setRatings(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  async function submitCurrentRating() {
    if (submitting) return
    setSubmitting(true)
    const cheese = currentCheese()
    const r = ratings[cheese.id]

    try {
      // Check for duplicate submission
      const { data: existing } = await supabase
        .from('ratings')
        .select('id')
        .eq('attendee_id', session.attendeeId)
        .eq('cheese_id', cheese.id)
        .maybeSingle()

      if (!existing) {
        await supabase.from('ratings').insert({
          attendee_id: session.attendeeId,
          cheese_id: cheese.id,
          dt_er_score: parseInt(r.dtEr),
          retire: r.retire === true,
          vc_score: parseInt(r.vc),
          roast: r.roast.trim() || null,
          submitted_at: new Date().toISOString(),
        })
      }

      if (currentIdx < cheeses.length - 1) {
        setCurrentIdx(i => i + 1)
        setPhase('reveal')
      } else {
        setPhase('photo')
      }
    } catch (e) {
      console.error(e)
      showToast('Failed to save — try again')
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePhotoUpload(e) {
    const files = Array.from(e.target.files)
    if (!files.length) return
    setUploadingPhoto(true)
    try {
      for (const file of files) {
        const ext = file.name.split('.').pop()
        const path = `party/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
        const { error } = await supabase.storage
          .from('party-photos')
          .upload(path, file, { contentType: file.type })
        if (!error) {
          const { data: { publicUrl } } = supabase.storage
            .from('party-photos')
            .getPublicUrl(path)
          setUploadedPhotos(prev => [...prev, publicUrl])
          // Save to DB
          await supabase.from('photos').insert({
            uploaded_by: session.attendeeId,
            url: publicUrl,
            path,
            uploaded_at: new Date().toISOString(),
          })
          showToast('Photo uploaded! 📸')
        }
      }
    } catch (e) {
      console.error(e)
      showToast('Upload failed — check your connection')
    } finally {
      setUploadingPhoto(false)
    }
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(''), 3000)
  }

  if (phase === 'loading' || loading) return <LoadingScreen />

  if (phase === 'waiting') return (
    <main className="page-enter" style={{ minHeight:'100vh', background:'var(--cream)' }}>
      <PageHeader />
      <div style={{ maxWidth:440, margin:'0 auto', padding:'2rem 1.25rem', textAlign:'center' }}>
        <div className="card">
          <span style={{ fontSize:'2.5rem', display:'block', marginBottom:'0.75rem' }}>⏳</span>
          <p className="font-display" style={{ fontSize:'1.1rem', fontWeight:700, marginBottom:'0.5rem' }}>Waiting for the host to open round 1</p>
          <p style={{ fontSize:'0.875rem', color:'var(--sesame-mid)', lineHeight:1.6 }}>
            Mingle! Grab a bagel. Your cheese assignment drops when the host starts the game.
          </p>
          <button className="btn-secondary" style={{ marginTop:'1rem' }} onClick={() => loadAssignedCheeses(session.attendeeId)}>
            Check again
          </button>
        </div>
      </div>
    </main>
  )

  if (phase === 'error') return (
    <main style={{ minHeight:'100vh', background:'var(--cream)', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="card" style={{ maxWidth:380, margin:'1rem' }}>
        <p className="font-display" style={{ fontSize:'1.1rem', fontWeight:700 }}>Something went wrong</p>
        <p style={{ color:'var(--sesame-mid)', marginTop:'0.5rem', fontSize:'0.875rem' }}>Tell the host — they can sort it out.</p>
        <button className="btn-secondary" style={{ marginTop:'1rem' }} onClick={() => window.location.reload()}>Retry</button>
      </div>
    </main>
  )

  const cheese = currentCheese()
  const rating = cheese ? ratings[cheese.id] : {}
  const progress = cheeses.length ? ((currentIdx + (phase === 'photo' || phase === 'social' || phase === 'done' ? 1 : 0)) / cheeses.length) * 100 : 0

  return (
    <main className="page-enter" style={{ minHeight:'100vh', background:'var(--cream)' }}>
      <PageHeader />

      <div style={{ maxWidth:440, margin:'0 auto', padding:'1.5rem 1.25rem 4rem' }}>

        {/* Progress */}
        {phase !== 'done' && (
          <div style={{ marginBottom:'1.25rem' }}>
            <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'0.4rem' }}>
              <span className="font-mono" style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)' }}>
                {phase === 'photo' || phase === 'social' ? 'Ratings complete' : `Cheese ${currentIdx + 1} of ${cheeses.length}`}
              </span>
              <span className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>{Math.round(progress)}%</span>
            </div>
            <div className="progress-track"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
          </div>
        )}

        {/* REVEAL phase */}
        {phase === 'reveal' && cheese && (
          <div className="page-enter">
            <div className="card" style={{ textAlign:'center', marginBottom:'1rem', padding:'2rem 1.5rem' }}>
              <span className="badge badge-dark" style={{ marginBottom:'1rem' }}>Your next cheese</span>
              <div style={{
                width:80, height:80, borderRadius:'50%',
                background:'var(--bagel)', color:'var(--white-cheese)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontFamily:'Playfair Display,serif', fontSize:'1.75rem', fontWeight:900,
                margin:'0 auto 1rem',
              }}>
                {cheese.id % 60 + 1}
              </div>
              <h2 className="font-display" style={{ fontSize:'1.4rem', fontWeight:700, marginBottom:'0.25rem' }}>
                {cheese.name}
              </h2>
              <p style={{ fontSize:'0.8rem', color:'var(--sesame-mid)', fontStyle:'italic' }}>
                Find the station labeled #{cheese.id % 60 + 1} and take a taste
              </p>
            </div>
            <div className="card-sm" style={{ marginBottom:'1rem', background:'var(--cream-dark)', border:'none' }}>
              <p className="font-mono" style={{ fontSize:'0.65rem', letterSpacing:'0.08em', textTransform:'uppercase', color:'var(--sesame-mid)', marginBottom:'0.3rem' }}>
                While you walk over...
              </p>
              <p style={{ fontSize:'0.875rem', lineHeight:1.6, fontStyle:'italic' }}>"{icebreaker}"</p>
            </div>
            <button className="btn-primary" onClick={() => setPhase('rating')}>
              I've tasted it — rate now →
            </button>
          </div>
        )}

        {/* RATING phase */}
        {phase === 'rating' && cheese && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem' }}>
              <div style={{ display:'flex', alignItems:'center', gap:'0.75rem', marginBottom:'1.25rem', paddingBottom:'1rem', borderBottom:'1px solid var(--border)' }}>
                <div style={{
                  width:44, height:44, borderRadius:'50%', background:'var(--bagel)',
                  color:'var(--white-cheese)', display:'flex', alignItems:'center', justifyContent:'center',
                  fontFamily:'Playfair Display,serif', fontSize:'1rem', fontWeight:900, flexShrink:0
                }}>
                  {cheese.id % 60 + 1}
                </div>
                <div>
                  <p className="font-display" style={{ fontSize:'1rem', fontWeight:700 }}>{cheese.name}</p>
                  <p style={{ fontSize:'0.75rem', color:'var(--sesame-mid)' }}>Rate honestly. Lives are on the line.</p>
                </div>
              </div>

              {/* Dollar Tree vs Erewhon */}
              <div style={{ marginBottom:'1.25rem' }}>
                <p style={{ fontSize:'0.875rem', fontWeight:600, marginBottom:'0.75rem' }}>
                  📍 Dollar Tree or Erewhon?
                </p>
                <input
                  type="range" min={1} max={10} step={1}
                  value={rating?.dtEr ?? 5}
                  onChange={e => updateRating('dtEr', e.target.value)}
                  style={{ marginBottom:'0.35rem' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>Dollar Tree</span>
                  <span className="font-mono" style={{ fontSize:'0.72rem', color:'var(--bagel)', fontWeight:500 }}>
                    {DT_ER_LABELS[rating?.dtEr ?? 5]}
                  </span>
                  <span className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>Erewhon</span>
                </div>
              </div>

              {/* Retire */}
              <div style={{ marginBottom:'1.25rem' }}>
                <p style={{ fontSize:'0.875rem', fontWeight:600, marginBottom:'0.5rem' }}>
                  🪦 Should this cream cheese be retired forever?
                </p>
                <div style={{ display:'flex', gap:'0.5rem' }}>
                  <button
                    className={`yn-btn ${rating?.retire === false ? 'yn-yes-active' : ''}`}
                    onClick={() => updateRating('retire', false)}
                  >No — it deserves life</button>
                  <button
                    className={`yn-btn ${rating?.retire === true ? 'yn-no-active' : ''}`}
                    onClick={() => updateRating('retire', true)}
                  >Yes — retire it 🪦</button>
                </div>
              </div>

              {/* VC Fundability */}
              <div style={{ marginBottom:'1.25rem' }}>
                <p style={{ fontSize:'0.875rem', fontWeight:600, marginBottom:'0.4rem' }}>
                  📈 VC Fundability
                </p>
                <p style={{ fontSize:'0.75rem', color:'var(--sesame-mid)', marginBottom:'0.6rem', fontStyle:'italic' }}>
                  "If this cream cheese pitched at Demo Day..."
                </p>
                <input
                  type="range" min={1} max={10} step={1}
                  value={rating?.vc ?? 5}
                  onChange={e => updateRating('vc', e.target.value)}
                  style={{ marginBottom:'0.35rem' }}
                />
                <div style={{ display:'flex', justifyContent:'space-between' }}>
                  <span className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>Pass</span>
                  <span className="font-mono" style={{ fontSize:'0.72rem', color:'var(--bagel)', fontWeight:500 }}>
                    {VC_LABELS[(rating?.vc ?? 5) - 1]}
                  </span>
                  <span className="font-mono" style={{ fontSize:'0.62rem', color:'var(--sesame-mid)' }}>🦄</span>
                </div>
              </div>

              {/* Roast */}
              <div>
                <span className="label">Hot take (optional — shown on live feed)</span>
                <textarea
                  style={{
                    width:'100%', padding:'0.65rem 0.875rem',
                    border:'1px solid var(--border)', borderRadius:8,
                    fontFamily:'Lora,serif', fontSize:'0.875rem',
                    background:'var(--cream)', color:'var(--sesame)',
                    resize:'none', outline:'none', minHeight:70
                  }}
                  placeholder={`e.g. "This tastes like a pivot deck for a cheese startup that will never ship..."`}
                  value={rating?.roast ?? ''}
                  onChange={e => updateRating('roast', e.target.value)}
                />
              </div>
            </div>

            {/* Timer + Submit */}
            {!canSubmit && (
              <div style={{ textAlign:'center', marginBottom:'0.75rem' }}>
                <span className="font-mono" style={{ fontSize:'0.72rem', color:'var(--sesame-mid)' }}>
                  Savoring... submit unlocks in {secondsLeft}s
                </span>
                <div className="progress-track" style={{ marginTop:'0.5rem' }}>
                  <div className="progress-fill" style={{ width:`${((30-secondsLeft)/30)*100}%`, background:'var(--sesame-mid)' }} />
                </div>
              </div>
            )}
            <button
              className="btn-primary"
              disabled={!canSubmit || submitting || rating?.retire === null}
              onClick={submitCurrentRating}
            >
              {submitting ? 'Saving...' : currentIdx < cheeses.length - 1 ? 'Submit & get next cheese →' : 'Submit final rating →'}
            </button>
            {rating?.retire === null && canSubmit && (
              <p style={{ textAlign:'center', fontSize:'0.75rem', color:'var(--poppy)', marginTop:'0.4rem' }}>
                Answer the retire question first ↑
              </p>
            )}
          </div>
        )}

        {/* PHOTO phase */}
        {phase === 'photo' && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem' }}>
              <span style={{ fontSize:'2rem', display:'block', marginBottom:'0.5rem' }}>📸</span>
              <p className="font-display" style={{ fontSize:'1.1rem', fontWeight:700, marginBottom:'0.5rem' }}>
                Ratings submitted! Drop some pics.
              </p>
              <p style={{ fontSize:'0.875rem', color:'var(--sesame-mid)', lineHeight:1.6, marginBottom:'1.25rem' }}>
                Help build the party photo album — the host gets all of them at the end. Selfies, cheese shots, candids, whatever.
              </p>

              {/* Upload area */}
              <div
                className="photo-drop"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('dragging') }}
                onDragLeave={e => e.currentTarget.classList.remove('dragging')}
                onDrop={e => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('dragging')
                  const files = Array.from(e.dataTransfer.files)
                  handlePhotoUpload({ target: { files } })
                }}
              >
                <span style={{ fontSize:'2rem', display:'block', marginBottom:'0.5rem' }}>
                  {uploadingPhoto ? '⏳' : '📷'}
                </span>
                <p className="font-mono" style={{ fontSize:'0.72rem', letterSpacing:'0.06em', color:'var(--sesame-mid)' }}>
                  {uploadingPhoto ? 'Uploading...' : 'Tap to add photos · or drag & drop'}
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  capture="environment"
                  style={{ display:'none' }}
                  onChange={handlePhotoUpload}
                />
              </div>

              {/* Uploaded preview */}
              {uploadedPhotos.length > 0 && (
                <div className="photo-grid" style={{ marginTop:'0.875rem' }}>
                  {uploadedPhotos.map((url, i) => (
                    <img key={i} src={url} alt="" style={{ borderRadius:8, aspectRatio:'1', objectFit:'cover', width:'100%' }} />
                  ))}
                </div>
              )}
            </div>

            <button className="btn-primary" onClick={() => setPhase('social')}>
              {uploadedPhotos.length > 0 ? 'Done uploading →' : 'Skip for now →'}
            </button>
          </div>
        )}

        {/* SOCIAL phase */}
        {phase === 'social' && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem', textAlign:'center' }}>
              <span style={{ fontSize:'2.5rem', display:'block', marginBottom:'0.5rem' }}>🏆</span>
              <p className="font-display" style={{ fontSize:'1.2rem', fontWeight:700, marginBottom:'0.5rem' }}>
                You're done for this round!
              </p>
              <p style={{ fontSize:'0.875rem', color:'var(--sesame-mid)', lineHeight:1.7 }}>
                Round results drop when the host closes voting. Until then — mingle, campaign for your cheese, eat a bagel.
              </p>
            </div>

            {/* Icebreaker mission */}
            <div className="card-sm" style={{ marginBottom:'1rem', background:'var(--cream-dark)', border:'none' }}>
              <p className="font-mono" style={{ fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)', marginBottom:'0.4rem' }}>
                Social mission
              </p>
              <p style={{ fontSize:'0.9rem', lineHeight:1.65, fontStyle:'italic' }}>"{icebreaker}"</p>
              <button
                className="btn-secondary"
                style={{ marginTop:'0.875rem', fontSize:'0.72rem' }}
                onClick={() => setIcebreaker(ICEBREAKERS[Math.floor(Math.random() * ICEBREAKERS.length)])}
              >
                Give me a different mission
              </button>
            </div>

            <button className="btn-primary" onClick={() => router.push('/host')}>
              Watch the live bracket →
            </button>
          </div>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
    </main>
  )
}

function PageHeader() {
  return (
    <div style={{
      textAlign:'center', padding:'1.25rem 1rem',
      background:'var(--white-cheese)',
      borderBottom:'1px solid var(--border)'
    }}>
      <h1 className="font-display" style={{ fontSize:'1.4rem', fontWeight:900 }}>🥯 The Bagel Bowl</h1>
      <p className="font-mono" style={{ fontSize:'0.6rem', letterSpacing:'0.12em', textTransform:'uppercase', color:'var(--sesame-mid)', marginTop:'0.2rem' }}>
        Cream Cheese Championship
      </p>
    </div>
  )
}

function LoadingScreen() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--cream)', gap:'1rem' }}>
      <span className="spin-slow" style={{ fontSize:'2.5rem' }}>🥯</span>
      <p className="font-mono" style={{ fontSize:'0.72rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-mid)' }}>
        Finding your cheeses...
      </p>
    </div>
  )
}
