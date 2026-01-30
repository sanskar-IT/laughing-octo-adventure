# Security Remediation Plan - AI Companion
**Created:** January 30, 2026  
**Goal:** Fix critical JWT vulnerability, resolve merge conflicts, implement production-ready CORS

---

## Summary

Based on comprehensive security audit, we have identified 1 CRITICAL vulnerability that requires immediate remediation:
- **CRITICAL:** JWT_SECRET fallback allows authentication bypass
- **MEDIUM:** Unresolved git merge conflicts in 4 files
- **LOW:** Wildcard CORS in SSE headers

---

## Phase 1: Critical Security Fix (JWT_SECRET)

### Target File
`backend/middleware/auth.js`

### Current Vulnerability
Line 6: Hardcoded fallback JWT secret allows token forgery if env var missing

### Proposed Fix
```javascript
// BEFORE (Line 6):
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// AFTER:
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  console.error('[Security] JWT_SECRET environment variable is not set');
  console.error('[Security] Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}
```

### Verification
- App should refuse to start without JWT_SECRET
- App should start normally with JWT_SECRET set

---

## Phase 2: Resolve Git Merge Conflicts

### Files to Fix

1. **package.json** (Lines 17-45)
   - Remove conflict markers, keep HEAD version with security deps
   - Keep: express-rate-limit, helmet, dotenv, litellm
   
2. **backend/server.js** (Lines 1-228)
   - Remove conflict markers, keep HEAD version
   - Keep: helmet middleware, rate limiting, CSP headers
   
3. **tts-server.py** (Lines 1-354)
   - Remove conflict markers, keep HEAD version
   - Keep: CORS validation, rate limiting, input sanitization
   
4. **src/App.tsx** (Lines 1-196)
   - Remove conflict markers, keep HEAD version
   - Keep: Enhanced TTS, character manager, streaming API

### Strategy
For each file:
1. Delete lines from `<<<<<<< HEAD` to `=======` marker
2. Delete `=======` marker and everything after through `>>>>>>>`
3. Clean up any remaining conflict artifacts

---

## Phase 3: Implement Explicit CORS Whitelisting

### Target Files

1. **backend/server.js**
   - Current: `origin: ['http://localhost:5173', 'http://127.0.0.1:5173']`
   - Keep as-is (already explicit), but add environment variable support

2. **backend/controllers/streamingController.js** (Line 64)
   - Current: `'Access-Control-Allow-Origin': '*'`
   - Fix: Use dynamic origin from request or whitelist

### Proposed Fix for streamingController.js
```javascript
// BEFORE (Line 64):
'Access-Control-Allow-Origin': '*',

// AFTER:
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];
const origin = req.headers.origin;
const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
'Access-Control-Allow-Origin': corsOrigin,
```

---

## Phase 4: Environment Configuration Updates

### Update .env.example
Add to existing file:
```bash
# Security
JWT_SECRET=your_secure_64_char_hex_string_here
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
NODE_ENV=development
```

---

## Verification Steps

After each fix:
1. **JWT Fix:** Test app startup with/without JWT_SECRET
2. **Merge Conflicts:** Run `npm install` to verify package.json valid
3. **CORS Fix:** Test frontend connection to backend
4. **Final:** Run `npm run lint` and `npm run build`

---

## Rollback Plan

If issues occur:
1. JWT fix: Revert to line with fallback (temporary for dev only)
2. CORS fix: Add '*' back to allowed origins temporarily
3. All changes tracked in git - can checkout previous commit

---

## Success Criteria

- [ ] JWT_SECRET required - app exits gracefully if missing
- [ ] All 4 merge conflicts resolved, files parsable
- [ ] CORS uses explicit whitelist, no wildcards
- [ ] `npm run lint` passes without errors
- [ ] `npm run build` completes successfully
- [ ] Frontend can still connect to backend locally

---

## Priority Order

1. **CRITICAL:** JWT_SECRET fix (security vulnerability)
2. **HIGH:** Resolve package.json conflict (blocks npm install)
3. **HIGH:** Resolve server.js conflict (backend won't run)
4. **MEDIUM:** CORS whitelist implementation
5. **MEDIUM:** tts-server.py and App.tsx conflicts
6. **LOW:** Update .env.example documentation
