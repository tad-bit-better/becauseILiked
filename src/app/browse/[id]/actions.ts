'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

const MIN_CHARS = 30
const MAX_CHARS = 2000

export async function saveLove(formData: FormData) {
  const itemId = formData.get('item_id') as string
  const freeText = (formData.get('free_text') as string)?.trim()

  if (!itemId || !freeText) {
    return { error: 'Missing required fields' }
  }
  if (freeText.length < MIN_CHARS) {
    return { error: `Please write at least ${MIN_CHARS} characters` }
  }
  if (freeText.length > MAX_CHARS) {
    return { error: `Please keep it under ${MAX_CHARS} characters` }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect(`/sign-in?next=/browse/${itemId}`)
  }

   // Check if this user already has a love for this item
  const { data: existing } = await supabase
    .from('user_loves')
    .select('id')
    .eq('user_id', user.id)
    .eq('item_id', itemId)
    .maybeSingle()

  if (existing) {
    return { error: 'You already added this one. Find it in My Loves to edit.' }
  }

  const { error: insertError } = await supabase.from('user_loves').insert({
    user_id: user.id,
    item_id: itemId,
    free_text: freeText,
  })

  if (insertError) {
    // Postgres error code 23505 = unique_violation.
    // This is the safety net if two requests raced past the check above.
    if (insertError.code === '23505') {
      return { error: 'You already added this one. Find it in My Loves to edit.' }
    }
    console.error('Failed to insert love:', insertError)
    return { error: 'Could not save your Love. Please try again.' }
  }

  revalidatePath('/my/loves')
  revalidatePath(`/browse/${itemId}`)
  redirect('/my/loves?added=1')
}