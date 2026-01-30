const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[Security] JWT_SECRET environment variable is not set');
  console.error('[Security] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

const USERS_FILE = path.join(__dirname, '../data/users.json');

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Access token required'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        success: false,
        error: 'Invalid or expired token'
      });
    }
    req.user = user;
    next();
  });
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role || 'user' },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function sanitizeInput(input, maxLength = 1000) {
  if (typeof input !== 'string') {
    return '';
  }
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  sanitized = sanitized.trim();
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  return sanitized;
}

function sanitizeChatMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  const sanitized = {
    role: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'user',
    content: sanitizeInput(message.content, 10000)
  };
  const injectionPatterns = [
    /ignore previous instructions/i,
    /disregard (all|your) (instructions|prompt)/i,
    /system prompt/i,
    /you are now/i,
    /new instructions/i,
    /override (your|the) (instructions|settings)/i
  ];
  const hasInjection = injectionPatterns.some(pattern => pattern.test(sanitized.content));
  if (hasInjection) {
    console.warn('[Security] Potential prompt injection detected:', sanitized.content.substring(0, 100));
  }
  return sanitized;
}

class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.windowMs = 15 * 60 * 1000;
    this.maxRequests = 100;
  }
  isAllowed(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    if (!this.requests.has(clientId)) {
      this.requests.set(clientId, []);
    }
    const clientRequests = this.requests.get(clientId);
    const validRequests = clientRequests.filter(time => time > windowStart);
    if (validRequests.length >= this.maxRequests) {
      return false;
    }
    validRequests.push(now);
    this.requests.set(clientId, validRequests);
    return true;
  }
  getRemaining(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    if (!this.requests.has(clientId)) {
      return this.maxRequests;
    }
    const clientRequests = this.requests.get(clientId);
    const validRequests = clientRequests.filter(time => time > windowStart);
    return Math.max(0, this.maxRequests - validRequests.length);
  }
}

const rateLimiter = new RateLimiter();

module.exports = {
  authenticateToken,
  generateToken,
  hashPassword,
  verifyPassword,
  sanitizeInput,
  sanitizeChatMessage,
  rateLimiter,
  JWT_SECRET
};
