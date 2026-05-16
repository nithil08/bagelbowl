'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../lib/supabase'
import { getDeviceId, getSavedSession, saveSession } from '../lib/assignment'

export default function Home() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [hasCheese, setHasCheese] = useState(null)   // true | false | null
  const [hasPartner, setHasPartner] = useState(null)  // true | false | null
  const [partnerName, setPartnerName] = useState('')
  const [cheeseName, setCheeseName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState(1) // 1=name, 2=cheese?, 3=partner?, 4=cheese name
  const [checkingSession, setCheckingSession] = useState(true)

  // On mount: restore session if this device already checked in
  useEffect(() => {
    const session = getSavedSession()
    if (session?.attendeeId) {
      router.push('/rate')
    } else {
      setCheckingSession(false)
    }
  }, [])

  if (checkingSession) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'var(--cream)' }}>
        <span className="spin-slow" style={{ fontSize:'2.5rem' }}>🥯</span>
      </div>
    )
  }

  async function handleSubmit() {
    if (!name.trim()) { setError('We need your name!'); return }
    setLoading(true)
    setError('')

    try {
      const deviceId = getDeviceId()

      // Check for duplicate device (different name, same device)
      const { data: existingDevice } = await supabase
        .from('attendees')
        .select('id, name')
        .eq('device_id', deviceId)
        .maybeSingle()

      if (existingDevice) {
        // Restore their session instead of creating a new one
        saveSession({ attendeeId: existingDevice.id, name: existingDevice.name })
        router.push('/rate')
        return
      }

      // Check for duplicate name
      const { data: existingName } = await supabase
        .from('attendees')
        .select('id')
        .ilike('name', name.trim())
        .maybeSingle()

      if (existingName) {
        setError('That name is already checked in — is that you? Try adding your last initial.')
        setLoading(false)
        return
      }

      // Determine role
      let role = 'competitor'
      if (!hasCheese) role = 'floater'
      if (!hasPartner) role = 'floater'

      // Check for cheese name duplicate if they brought one
      if (hasCheese && cheeseName.trim()) {
        const { data: dupCheese } = await supabase
          .from('cheeses')
          .select('id, name')
          .ilike('name', cheeseName.trim())
          .maybeSingle()

        if (dupCheese) {
          setError(`"${cheeseName}" is already registered! Did someone else bring the same one? Tell the host.`)
          setLoading(false)
          return
        }
      }

      // Create attendee
      const { data: attendee, error: attendeeErr } = await supabase
        .from('attendees')
        .insert({
          name: name.trim(),
          partner_name: hasPartner ? partnerName.trim() : null,
          device_id: deviceId,
          role,
          has_cheese: hasCheese,
          checked_in_at: new Date().toISOString(),
        })
        .select()
        .single()

      if (attendeeErr) throw attendeeErr

      // If they brought a cheese, register it (host will activate it)
      if (hasCheese && cheeseName.trim()) {
        const { data: cheese, error: cheeseErr } = await supabase
          .from('cheeses')
          .insert({
            name: cheeseName.trim(),
            brought_by: attendee.id,
            partner_name: hasPartner ? partnerName.trim() : null,
            active: false, // host activates after dedup check
            round: 1,
            assignment_count: 0,
          })
          .select()
          .single()

        if (!cheeseErr) {
          await supabase
            .from('attendees')
            .update({ own_cheese_id: cheese.id })
            .eq('id', attendee.id)
        }
      }

      saveSession({ attendeeId: attendee.id, name: attendee.name, role })
      router.push('/rate')
    } catch (e) {
      console.error(e)
      setError('Something went wrong. Try again in a sec.')
      setLoading(false)
    }
  }

  return (
    <main className="page-enter" style={{ minHeight:'100vh', background:'var(--cream)' }}>
      {/* Header */}
      <div style={{
        textAlign:'center', padding:'2.5rem 1rem 2rem',
        background:'var(--white-cheese)',
        borderBottom:'1px solid var(--border)'
      }}>
        <span className="spin-slow" style={{ fontSize:'3rem', display:'block', marginBottom:'0.5rem' }}>🥯</span>
        <h1 className="font-display" style={{ fontSize:'2.2rem', fontWeight:900, letterSpacing:'-0.02em', lineHeight:1.1 }}>
          The Bagel Bowl
        </h1>
        <p className="font-mono" style={{ fontSize:'0.65rem', letterSpacing:'0.14em', textTransform:'uppercase', color:'var(--sesame-mid)', marginTop:'0.4rem' }}>
          Cream Cheese Championship · {new Date().getFullYear()}
        </p>
      </div>

      <div style={{ maxWidth:440, margin:'0 auto', padding:'2rem 1.25rem' }}>

        {/* Step 1 — Name */}
        {step === 1 && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem' }}>
              <p className="font-display" style={{ fontSize:'1.15rem', fontWeight:700, marginBottom:'0.4rem' }}>
                Welcome, competitor.
              </p>
              <p style={{ fontSize:'0.875rem', color:'var(--sesame-mid)', lineHeight:1.7, marginBottom:'1.25rem' }}>
                No login. No account. Just your name, your palate, and your opinions.
              </p>
              <span className="label">Your full name</span>
              <input
                className="input"
                style={{ marginBottom:'0.75rem' }}
                placeholder="e.g. Maya Chen"
                value={name}
                onChange={e => { setName(e.target.value); setError('') }}
                onKeyDown={e => e.key === 'Enter' && name.trim() && setStep(2)}
                autoFocus
              />
              {error && (
                <p style={{ fontSize:'0.8rem', color:'var(--poppy)', marginBottom:'0.75rem', fontStyle:'italic' }}>{error}</p>
              )}
              <button
                className="btn-primary"
                disabled={!name.trim()}
                onClick={() => setStep(2)}
              >
                Continue →
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Did you bring a cheese? */}
        {step === 2 && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem' }}>
              <p className="font-display" style={{ fontSize:'1.1rem', fontWeight:700, marginBottom:'1rem' }}>
                Hey {name.split(' ')[0]}! Did you bring a cream cheese?
              </p>
              <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                <button
                  className="yn-btn"
                  style={{ width:'100%', padding:'0.875rem' }}
                  onClick={() => { setHasCheese(true); setStep(3) }}
                >
                  Yes — I've got a contender 🧀
                </button>
                <button
                  className="yn-btn"
                  style={{ width:'100%', padding:'0.875rem' }}
                  onClick={() => { setHasCheese(false); setHasPartner(false); handleFloaterSubmit() }}
                >
                  No — I'm judging without a horse in the race
                </button>
              </div>
            </div>
            <button className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
          </div>
        )}

        {/* Step 3 — Do you have a partner? */}
        {step === 3 && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem' }}>
              <p className="font-display" style={{ fontSize:'1.1rem', fontWeight:700, marginBottom:'1rem' }}>
                Did you come with a partner?
              </p>
              <p style={{ fontSize:'0.85rem', color:'var(--sesame-mid)', lineHeight:1.6, marginBottom:'1rem' }}>
                Partners share a cheese and cheer it on together. Solo? No worries — we'll pair you up.
              </p>
              <div style={{ display:'flex', gap:'0.5rem', marginBottom:'1rem' }}>
                <button
                  className={`yn-btn ${hasPartner === true ? 'yn-yes-active' : ''}`}
                  onClick={() => setHasPartner(true)}
                >
                  Yes, with a partner
                </button>
                <button
                  className={`yn-btn ${hasPartner === false ? 'yn-no-active' : ''}`}
                  onClick={() => setHasPartner(false)}
                >
                  I'm solo
                </button>
              </div>
              {hasPartner === true && (
                <div style={{ marginBottom:'0.75rem' }}>
                  <span className="label">Partner's name</span>
                  <input
                    className="input"
                    placeholder="e.g. Jordan Kim"
                    value={partnerName}
                    onChange={e => setPartnerName(e.target.value)}
                  />
                </div>
              )}
              <button
                className="btn-primary"
                disabled={hasPartner === null || (hasPartner && !partnerName.trim())}
                onClick={() => setStep(4)}
              >
                Continue →
              </button>
            </div>
            <button className="btn-secondary" onClick={() => setStep(2)}>← Back</button>
          </div>
        )}

        {/* Step 4 — Cheese name */}
        {step === 4 && (
          <div className="page-enter">
            <div className="card" style={{ marginBottom:'1rem' }}>
              <p className="font-display" style={{ fontSize:'1.1rem', fontWeight:700, marginBottom:'0.5rem' }}>
                Name your champion.
              </p>
              <p style={{ fontSize:'0.85rem', color:'var(--sesame-mid)', lineHeight:1.6, marginBottom:'1rem' }}>
                Be specific — "Philadelphia Plain" beats "cream cheese." The more descriptive, the better.
              </p>
              <span className="label">Cream cheese name / brand / flavor</span>
              <input
                className="input"
                style={{ marginBottom:'0.75rem' }}
                placeholder="e.g. Kite Hill Chive & Onion"
                value={cheeseName}
                onChange={e => { setCheeseName(e.target.value); setError('') }}
              />
              {error && (
                <p style={{ fontSize:'0.8rem', color:'var(--poppy)', marginBottom:'0.75rem', fontStyle:'italic' }}>{error}</p>
              )}
              <button
                className="btn-primary"
                disabled={!cheeseName.trim() || loading}
                onClick={handleSubmit}
              >
                {loading ? 'Registering...' : "Let's go 🥯"}
              </button>
            </div>
            <button className="btn-secondary" onClick={() => setStep(3)}>← Back</button>
          </div>
        )}

        {/* Host link */}
        <div style={{ textAlign:'center', marginTop:'1.5rem' }}>
          <a
            href="/host"
            style={{ fontFamily:'DM Mono,monospace', fontSize:'0.62rem', letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--sesame-light)', textDecoration:'none' }}
          >
            Host dashboard →
          </a>
        </div>
      </div>
    </main>
  )

  async function handleFloaterSubmit() {
    setLoading(true)
    try {
      const deviceId = getDeviceId()
      const { data: attendee } = await supabase
        .from('attendees')
        .insert({
          name: name.trim(),
          device_id: deviceId,
          role: 'floater',
          has_cheese: false,
          checked_in_at: new Date().toISOString(),
        })
        .select()
        .single()
      saveSession({ attendeeId: attendee.id, name: attendee.name, role: 'floater' })
      router.push('/rate')
    } catch {
      setLoading(false)
    }
  }
}
