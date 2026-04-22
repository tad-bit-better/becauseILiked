import { config } from 'dotenv'
config({ path: '.env.local' })

async function testOpenAI() {
  console.log('Testing OpenAI...')
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: 'hello world',
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenAI test failed: ${response.status}\n${body}`)
  }

  const data = await response.json()
  console.log(
    `  ✅ OpenAI works. Got embedding of length ${data.data[0].embedding.length} (expected 1536)`
  )
}

async function testAnthropic() {
  console.log('Testing Anthropic (Claude Haiku 4.5)...')
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 50,
      messages: [
        { role: 'user', content: 'Say "hello from haiku" in exactly those words.' },
      ],
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Anthropic test failed: ${response.status}\n${body}`)
  }

  const data = await response.json()
  const text = data.content[0]?.text ?? '(no text)'
  console.log(`  ✅ Anthropic works. Response: "${text}"`)
}

async function main() {
  await testOpenAI()
  await testAnthropic()
  console.log('\nAll APIs reachable. Ready for Phase 3.')
}

main().catch((err) => {
  console.error('\n❌ Smoke test failed:')
  console.error(err)
  process.exit(1)
})