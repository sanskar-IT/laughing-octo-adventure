import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'

const dataDir = path.resolve('data')
const memoryFile = path.join(dataDir, 'memory.json')

function ensureFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true })
  if (!fs.existsSync(memoryFile)) fs.writeFileSync(memoryFile, JSON.stringify([]))
}

export function loadRecent(limit = 10) {
  ensureFile()
  const raw = fs.readFileSync(memoryFile, 'utf-8')
  const parsed = JSON.parse(raw)
  return parsed.slice(-limit)
}

export function appendMemory(role, content) {
  ensureFile()
  const raw = fs.readFileSync(memoryFile, 'utf-8')
  const parsed = JSON.parse(raw)
  parsed.push({ id: uuid(), role, content, createdAt: Date.now() })
  fs.writeFileSync(memoryFile, JSON.stringify(parsed.slice(-50), null, 2))
}
