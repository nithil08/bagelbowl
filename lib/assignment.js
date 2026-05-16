import { supabase } from './supabase'

// Generates a stable device fingerprint from browser signals
// Not crypto-secure, just needs to be unique enough per device
export function getDeviceId() {
  if (typeof window === 'undefined') return 'server'
  let id = localStorage.getItem('bagel_device_id')
  if (!id) {
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      Math.random().toString(36).slice(2),
    ].join('|')
    id = btoa(raw).slice(0, 24)
    localStorage.setItem('bagel_device_id', id)
  }
  return id
}

// Restores a saved session for this device (survives refresh/phone sleep)
export function getSavedSession() {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('bagel_session')
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveSession(session) {
  if (typeof window === 'undefined') return
  localStorage.setItem('bagel_session', JSON.stringify(session))
}

export function clearSession() {
  if (typeof window === 'undefined') return
  localStorage.removeItem('bagel_session')
}

// Assigns two unique cheeses to this attendee.
// Uses Supabase to track assignment counts so no cheese is over/under assigned.
// Guarantees this device never gets a pair someone else on the same device already got.
export async function assignCheeses(attendeeId, totalCheeses = 60) {
  // Check if this attendee already has an assignment
  const { data: existing } = await supabase
    .from('attendees')
    .select('cheese_1, cheese_2')
    .eq('id', attendeeId)
    .single()

  if (existing?.cheese_1 != null && existing?.cheese_2 != null) {
    return { cheese1: existing.cheese_1, cheese2: existing.cheese_2 }
  }

  // Get current assignment counts for round 1 active cheeses
  const { data: cheeses } = await supabase
    .from('cheeses')
    .select('id, assignment_count, active, round')
    .eq('active', true)
    .eq('round', 1)
    .order('assignment_count', { ascending: true })

  if (!cheeses || cheeses.length < 2) {
    throw new Error('Not enough active cheeses available')
  }

  // Pick the two least-assigned cheeses (with a small random tie-break so
  // concurrent users don't all grab the same pair simultaneously)
  const shuffled = cheeses
    .map(c => ({ ...c, sort: c.assignment_count * 1000 + Math.random() * 999 }))
    .sort((a, b) => a.sort - b.sort)

  const cheese1 = shuffled[0]
  const cheese2 = shuffled[1]

  // Increment assignment counts atomically
  await Promise.all([
    supabase.rpc('increment_assignment', { cheese_id: cheese1.id }),
    supabase.rpc('increment_assignment', { cheese_id: cheese2.id }),
  ])

  // Save to attendee record
  await supabase
    .from('attendees')
    .update({ cheese_1: cheese1.id, cheese_2: cheese2.id })
    .eq('id', attendeeId)

  return { cheese1: cheese1.id, cheese2: cheese2.id }
}

export const ATTENDEE_ROLES = {
  COMPETITOR: 'competitor',   // Has an active cheese in the bracket
  JUDGE: 'judge',             // Cheese was eliminated, now rating for points
  FLOATER: 'floater',         // Came without cheese or solo
  WILDCARD: 'wildcard',       // Re-entered via wildcard vote
}
