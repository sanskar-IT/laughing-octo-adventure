const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const USERS_FILE = path.join(__dirname, '../data/users.json');

/**
 * Authentication middleware
 * Validates JWT token from Authorization header
 */
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

/**
 * Generate JWT token for user
 * @param {Object} user - User object
 * @returns {string} JWT token
 */
function generateToken(user) {
  return jwt.sign(
    { 
      id: user.id, 
      username: user.username,
      role: user.role || 'user'
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

/**
 * Hash password using bcrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
async function hashPassword(password) {
  const salt = await bcrypt.genSalt(12);
  return bcrypt.hash(password, salt);
}

/**
 * Verify password against hash
 * @param {string} password - Plain text password
 * @param {string} hash - Hashed password
 * @returns {Promise<boolean>} Match result
 */
async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

/**
 * Input sanitization helper
 * Removes potentially dangerous characters and limits length
 * @param {string} input - Raw input string
 * @param {number} maxLength - Maximum allowed length
 * @returns {string} Sanitized string
 */
function sanitizeInput(input, maxLength = 1000) {
  if (typeof input !== 'string') {
    return '';
  }
  
  // Remove null bytes and control characters
  let sanitized = input.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  // Trim whitespace
  sanitized = sanitized.trim();
  
  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }
  
  return sanitized;
}

/**
 * Validate and sanitize chat message
 * @param {Object} message - Message object
 * @returns {Object} Sanitized message
 */
function sanitizeChatMessage(message) {
  if (!message || typeof message !== 'object') {
    return null;
  }
  
  const sanitized = {
    role: ['user', 'assistant', 'system'].includes(message.role) ? message.role : 'user',
    content: sanitizeInput(message.content, 10000)
  };
  
  // Check for prompt injection patterns
  const injectionPatterns = [
    /ignore previous instructions/i,
    /disregard (all|your) (instructions|prompt)/i,
    /system prompt/i,
    /you are now/i,
    /new instructions/i,
    /override (your|the) (instructions|settings)/i
  ];
  
  const hasInjection = injectionPatterns.some(pattern => 
    pattern.test(sanitized.content)
  );
  
  if (hasInjection) {
    console.warn('[Security] Potential prompt injection detected:', sanitized.content.substring(0, 100));
    // Don't block, but log for monitoring
  }
  
  return sanitized;
}

/**
 * Rate limiting helper for specific endpoints
 * Uses in-memory store (consider Redis for production)
 */
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.windowMs = 15 * 60 * 1000; // 15 minutes
    this.maxRequests = 100;
  }
  
  isAllowed(clientId) {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    
    if (!this.requests.has(clientId)) {
      this.requests.set(clientId, []);
    }
    
    const clientRequests = this.requests.get(clientId);
    
    // Remove old requests outside window
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
