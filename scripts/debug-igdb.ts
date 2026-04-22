import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const clientId = process.env.TWITCH_CLIENT_ID!
  const clientSecret = process.env.TWITCH_CLIENT_SECRET!

  // Get token
  const tokenRes = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${clientId}&client_secret=${clientSecret}&grant_type=client_credentials`,
    { method: 'POST' }
  )
  const tokenData = await tokenRes.json()
  console.log('Token response:', tokenData)

  // Minimal games query — no filters, just top 5
  const body = `fields name, rating; limit 5;`
  const gamesRes = await fetch('https://api.igdb.com/v4/games', {
    method: 'POST',
    headers: {
      'Client-ID': clientId,
      Authorization: `Bearer ${tokenData.access_token}`,
      'Content-Type': 'text/plain',
    },
    body,
  })

  console.log('Games response status:', gamesRes.status)
  const gamesData = await gamesRes.text()
  console.log('Games response body:', gamesData)
}

main().catch(console.error)