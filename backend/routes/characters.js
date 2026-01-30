const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const CharacterCardParser = require('../characters/CharacterCardParser');

const router = express.Router();

// Configuration
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB max for JSON files
const CHARACTERS_DIR = path.join(__dirname, '../data/characters');
const UPLOAD_DIR = path.join(__dirname, '../uploads');

// Ensure directories exist
[CHARACTERS_DIR, UPLOAD_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Multer configuration for character cards
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    cb(null, `${uniqueId}.json`);
  }
});

const fileFilter = (req, file, cb) => {
  // Accept JSON files and PNG files (Chub cards are often PNG with embedded JSON)
  if (file.mimetype === 'application/json' || 
      file.mimetype === 'image/png' ||
      file.originalname.endsWith('.json')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only JSON and PNG files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: 1
  },
  fileFilter
});

/**
 * Extract JSON from PNG file (Chub AI format)
 * PNG files may contain character card data in tEXt chunks
 */
async function extractJsonFromPng(pngPath) {
  try {
    const buffer = await fs.promises.readFile(pngPath);
    
    // Look for tEXt chunks in PNG
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    let offset = 8; // Skip PNG signature
    
    while (offset < buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      
      if (type === 'tEXt') {
        const data = buffer.toString('ascii', offset + 8, offset + 8 + length);
        const nullIndex = data.indexOf('\x00');
        
        if (nullIndex !== -1) {
          const keyword = data.substring(0, nullIndex);
          const text = data.substring(nullIndex + 1);
          
          // Chub AI uses 'chara' keyword
          if (keyword === 'chara') {
            try {
              // Text might be base64 encoded
              const decoded = Buffer.from(text, 'base64').toString('utf8');
              return JSON.parse(decoded);
            } catch (e) {
              // Try direct JSON parse
              return JSON.parse(text);
            }
          }
        }
      }
      
      if (type === 'IEND') {
        break;
      }
      
      offset += 12 + length; // length (4) + type (4) + data (length) + CRC (4)
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting JSON from PNG:', error);
    return null;
  }
}

// Routes

/**
 * Upload character card (JSON or PNG format)
 */
router.post('/upload', authenticateToken, upload.single('character'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const uploadedFile = req.file;
    let characterData = null;
    let sourceFormat = 'json';

    // Parse based on file type
    if (uploadedFile.mimetype === 'image/png' || uploadedFile.originalname.endsWith('.png')) {
      // Extract from PNG
      characterData = await extractJsonFromPng(uploadedFile.path);
      sourceFormat = 'png';
      
      if (!characterData) {
        await fs.promises.unlink(uploadedFile.path);
        return res.status(400).json({
          success: false,
          error: 'Could not extract character data from PNG file'
        });
      }
    } else {
      // Parse JSON file
      try {
        const fileContent = await fs.promises.readFile(uploadedFile.path, 'utf8');
        characterData = JSON.parse(fileContent);
      } catch (error) {
        await fs.promises.unlink(uploadedFile.path);
        return res.status(400).json({
          success: false,
          error: 'Invalid JSON format'
        });
      }
    }

    // Validate character card
    const validation = CharacterCardParser.validate(characterData);
    
    if (!validation.valid) {
      await fs.promises.unlink(uploadedFile.path);
      return res.status(400).json({
        success: false,
        error: 'Invalid character card format',
        details: validation.errors
      });
    }

    // Parse character data
    const parsedCharacter = CharacterCardParser.parse(characterData);
    const characterId = uuidv4();
    
    // Create character record with metadata
    const characterRecord = {
      id: characterId,
      name: parsedCharacter.name,
      data: characterData,
      parsed: parsedCharacter,
      sourceFormat,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: req.user?.username || 'unknown',
      // Allow association with Live2D model
      live2dModelId: req.body.live2dModelId || null,
      live2dModelPath: req.body.live2dModelPath || null
    };

    // Save character to database
    const characterPath = path.join(CHARACTERS_DIR, `${characterId}.json`);
    await fs.promises.writeFile(
      characterPath, 
      JSON.stringify(characterRecord, null, 2)
    );

    // Cleanup uploaded file
    await fs.promises.unlink(uploadedFile.path);

    console.log(`[Security] Character uploaded by user: ${req.user?.username || 'unknown'} - ${parsedCharacter.name}`);

    res.json({
      success: true,
      data: {
        characterId,
        name: parsedCharacter.name,
        description: parsedCharacter.description,
        personality: parsedCharacter.personality,
        firstMessage: parsedCharacter.firstMessage,
        systemPrompt: parsedCharacter.systemPrompt,
        live2dModelId: characterRecord.live2dModelId,
        live2dModelPath: characterRecord.live2dModelPath,
        validation: {
          valid: true,
          warnings: validation.warnings
        }
      }
    });

  } catch (error) {
    console.error('Character upload error:', error);
    
    if (req.file) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error during character upload'
    });
  }
});

/**
 * List all characters
 */
router.get('/characters', authenticateToken, async (req, res) => {
  try {
    const files = await fs.promises.readdir(CHARACTERS_DIR);
    const characters = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        try {
          const filePath = path.join(CHARACTERS_DIR, file);
          const content = await fs.promises.readFile(filePath, 'utf8');
          const character = JSON.parse(content);
          
          characters.push({
            id: character.id,
            name: character.name,
            description: character.parsed?.description?.substring(0, 100) + '...',
            personality: character.parsed?.personality?.substring(0, 50) + '...',
            live2dModelId: character.live2dModelId,
            live2dModelPath: character.live2dModelPath,
            createdAt: character.createdAt,
            updatedAt: character.updatedAt
          });
        } catch (error) {
          console.warn(`Error reading character file ${file}:`, error.message);
        }
      }
    }

    // Sort by updated date
    characters.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json({
      success: true,
      data: characters
    });

  } catch (error) {
    console.error('Error listing characters:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list characters'
    });
  }
});

/**
 * Get single character by ID
 */
router.get('/characters/:characterId', authenticateToken, async (req, res) => {
  try {
    const { characterId } = req.params;
    
    // Security: Validate characterId format
    if (!characterId || !/^[a-f0-9-]+$/.test(characterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid character ID format'
      });
    }
    
    const characterPath = path.join(CHARACTERS_DIR, `${characterId}.json`);
    
    // Security: Verify path is within CHARACTERS_DIR
    const resolvedPath = path.resolve(characterPath);
    const resolvedCharDir = path.resolve(CHARACTERS_DIR);
    
    if (!resolvedPath.startsWith(resolvedCharDir)) {
      console.error(`[Security] Path traversal attempt: ${characterId}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    if (!fs.existsSync(characterPath)) {
      return res.status(404).json({
        success: false,
        error: 'Character not found'
      });
    }

    const content = await fs.promises.readFile(characterPath, 'utf8');
    const character = JSON.parse(content);

    res.json({
      success: true,
      data: {
        id: character.id,
        name: character.name,
        data: character.data,
        parsed: character.parsed,
        live2dModelId: character.live2dModelId,
        live2dModelPath: character.live2dModelPath,
        createdAt: character.createdAt,
        updatedAt: character.updatedAt
      }
    });

  } catch (error) {
    console.error('Error getting character:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get character'
    });
  }
});

/**
 * Update character (including Live2D model association)
 */
router.put('/characters/:characterId', authenticateToken, async (req, res) => {
  try {
    const { characterId } = req.params;
    const { live2dModelId, live2dModelPath } = req.body;
    
    // Security: Validate characterId format
    if (!characterId || !/^[a-f0-9-]+$/.test(characterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid character ID format'
      });
    }
    
    const characterPath = path.join(CHARACTERS_DIR, `${characterId}.json`);
    
    // Security: Verify path
    const resolvedPath = path.resolve(characterPath);
    const resolvedCharDir = path.resolve(CHARACTERS_DIR);
    
    if (!resolvedPath.startsWith(resolvedCharDir)) {
      console.error(`[Security] Path traversal attempt in update: ${characterId}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    if (!fs.existsSync(characterPath)) {
      return res.status(404).json({
        success: false,
        error: 'Character not found'
      });
    }

    const content = await fs.promises.readFile(characterPath, 'utf8');
    const character = JSON.parse(content);

    // Update fields
    if (live2dModelId !== undefined) {
      character.live2dModelId = live2dModelId;
    }
    if (live2dModelPath !== undefined) {
      character.live2dModelPath = live2dModelPath;
    }
    character.updatedAt = new Date().toISOString();

    await fs.promises.writeFile(characterPath, JSON.stringify(character, null, 2));

    console.log(`[Security] Character updated by user: ${req.user?.username || 'unknown'} - ${character.name}`);

    res.json({
      success: true,
      data: {
        id: character.id,
        name: character.name,
        live2dModelId: character.live2dModelId,
        live2dModelPath: character.live2dModelPath,
        updatedAt: character.updatedAt
      }
    });

  } catch (error) {
    console.error('Error updating character:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update character'
    });
  }
});

/**
 * Delete character
 */
router.delete('/characters/:characterId', authenticateToken, async (req, res) => {
  try {
    const { characterId } = req.params;
    
    // Security: Validate characterId format
    if (!characterId || !/^[a-f0-9-]+$/.test(characterId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid character ID format'
      });
    }
    
    const characterPath = path.join(CHARACTERS_DIR, `${characterId}.json`);
    
    // Security: Verify path
    const resolvedPath = path.resolve(characterPath);
    const resolvedCharDir = path.resolve(CHARACTERS_DIR);
    
    if (!resolvedPath.startsWith(resolvedCharDir)) {
      console.error(`[Security] Path traversal attempt in delete: ${characterId}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    if (!fs.existsSync(characterPath)) {
      return res.status(404).json({
        success: false,
        error: 'Character not found'
      });
    }

    // Get character name for logging
    const content = await fs.promises.readFile(characterPath, 'utf8');
    const character = JSON.parse(content);

    await fs.promises.unlink(characterPath);

    console.log(`[Security] Character deleted by user: ${req.user?.username || 'unknown'} - ${character.name}`);

    res.json({
      success: true,
      message: 'Character deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting character:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete character'
    });
  }
});

module.exports = router;
