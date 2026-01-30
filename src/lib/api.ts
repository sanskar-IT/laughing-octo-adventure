import axios from 'axios'
import config from '../../config.json'

const BASE_URL = config.lmStudio.baseUrl
const TTS_URL = `http://${config.tts.host}:${config.tts.port}`

const client = axios.create({
  baseURL: BASE_URL,
  timeout: config.lmStudio.timeout,
  headers: { 'Content-Type': 'application/json' }
})

export async function sendChat(messages: { role: string; content: string }[]) {
  const enforced = BASE_URL.startsWith('http://localhost') || BASE_URL.startsWith('http://127.0.0.1')
  if (!enforced && config.privacy.enforceLocalhost) {
    throw new Error('Remote endpoints blocked by privacy settings.')
  }

  const system = { role: 'system', content: config.lmStudio.systemPrompt }
  const response = await client.post('/chat/completions', {
    model: config.lmStudio.model,
    messages: [system, ...messages],
    max_tokens: config.lmStudio.maxTokens,
    temperature: config.lmStudio.temperature,
    stream: false
  })
  return response.data
}

export async function generateTts(text: string) {
  const url = `${TTS_URL}/generate`
  if (!(url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) && config.privacy.enforceLocalhost) {
    throw new Error('Remote TTS endpoints blocked by privacy settings.')
  }
  const { data } = await axios.post(url, { text }, { timeout: 30000 })
  return data
}
