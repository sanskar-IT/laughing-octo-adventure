const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const unzipper = require('unzipper');
const { authenticateToken } = require('../middleware/auth');

const __dirname = path.dirname(__dirname);

const router = express.Router();

// Security configurations
const ALLOWED_MIME_TYPES = [
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream'
];

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB max
const UPLOAD_DIR = path.join(__dirname, '../uploads');
const MODELS_DIR = path.join(__dirname, '../public/models');

// Ensure directories exist
[UPLOAD_DIR, MODELS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Secure multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname) || '.zip';
    cb(null, `${uniqueId}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only ZIP files are allowed.'), false);
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

// Live2D model validation
class Live2DModelValidator {
  static async validateModel(modelPath) {
    try {
      const files = await fs.promises.readdir(modelPath);
      
      // Check for required model files
      const hasModel3Json = files.some(file => file.endsWith('.model3.json'));
      if (!hasModel3Json) {
        throw new Error('Missing .model3.json file');
      }

      // Find the main model file
      const modelJsonFile = files.find(file => file.endsWith('.model3.json'));
      const modelJsonPath = path.join(modelPath, modelJsonFile);
      
      const modelJson = JSON.parse(await fs.promises.readFile(modelJsonPath, 'utf8'));
      
      // Validate model structure
      if (!modelJson.FileReferences || !modelJson.FileReferences.Moc) {
        throw new Error('Invalid model structure');
      }

      // Extract model capabilities
      const capabilities = this.extractCapabilities(modelJson, modelPath);
      
      return {
        valid: true,
        modelPath: modelJsonFile.replace('.model3.json', ''),
        capabilities,
        metadata: {
          name: modelJson.FileReferences.Moc?.split('/').pop()?.replace('.moc3', '') || 'Unknown',
          version: modelJson.Version || 'Unknown',
          author: modelJson.Meta?.Comment || 'Unknown'
        }
      };
    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  static extractCapabilities(modelJson, modelPath) {
    const capabilities = {
      hasEyeBlink: false,
      hasLipSync: false,
      hasBreath: false,
      hasPhysics: false,
      hasExpressions: false,
      hasMotions: false,
      parameters: [],
      expressions: []
    };

    // Check for motion groups
    if (modelJson.FileReferences.Motions) {
      capabilities.hasMotions = true;
      capabilities.motionGroups = Object.keys(modelJson.FileReferences.Motions);
    }

    // Check for expressions
    if (modelJson.FileReferences.Expressions) {
      capabilities.hasExpressions = true;
      capabilities.expressions = modelJson.FileReferences.Expressions.map(expr => ({
        name: expr.File?.split('/').pop()?.replace('.exp3.json', '') || 'Unknown',
        file: expr.File
      }));
    }

    // Check physics
    if (modelJson.FileReferences.Physics) {
      capabilities.hasPhysics = true;
    }

    // Analyze parameters for common features
    if (modelJson.Groups) {
      capabilities.hasEyeBlink = modelJson.Groups.some(group => 
        group.Id.toLowerCase().includes('eye') || 
        group.Id.toLowerCase().includes('blink')
      );
      
      capabilities.hasLipSync = modelJson.Groups.some(group => 
        group.Id.toLowerCase().includes('lip') || 
        group.Id.toLowerCase().includes('mouth')
      );
      
      capabilities.hasBreath = modelJson.Groups.some(group => 
        group.Id.toLowerCase().includes('breath') || 
        group.Id.toLowerCase().includes('breathing')
      );
    }

    // Extract available parameters
    if (modelJson.Groups) {
      capabilities.parameters = modelJson.Groups.map(group => ({
        id: group.Id,
        name: group.Id,
        target: group.Target || 'Parameter',
        type: this.getParameterType(group.Id)
      }));
    }

    return capabilities;
  }

  static getParameterType(paramId) {
    const lowerId = paramId.toLowerCase();
    if (lowerId.includes('eye')) return 'eye';
    if (lowerId.includes('lip') || lowerId.includes('mouth')) return 'lip';
    if (lowerId.includes('neck') || lowerId.includes('head')) return 'head';
    if (lowerId.includes('breath')) return 'breath';
    if (lowerId.includes('body')) return 'body';
    return 'general';
  }
}

// Security configuration for ZIP extraction
const MAX_EXTRACT_SIZE = 200 * 1024 * 1024; // 200MB max extracted size
const MAX_FILES_COUNT = 1000; // Maximum number of files in ZIP
const ALLOWED_EXTENSIONS = ['.json', '.moc3', '.png', '.jpeg', '.jpg', '.wav', '.mp3', '.ogg'];

/**
 * Secure ZIP extraction with path traversal protection
 * @param {string} zipPath - Path to ZIP file
 * @param {string} extractDir - Directory to extract to
 * @returns {Promise<Object>} Extraction result
 */
async function secureExtractZip(zipPath, extractDir) {
  let totalSize = 0;
  let fileCount = 0;
  const extractedFiles = [];
  
  return new Promise((resolve, reject) => {
    const extractionStream = fs.createReadStream(zipPath)
      .pipe(unzipper.Parse());
    
    extractionStream.on('entry', async (entry) => {
      const entryPath = entry.path;
      const entryType = entry.type;
      
      // Security check 1: Prevent path traversal
      const fullPath = path.join(extractDir, entryPath);
      const resolvedPath = path.resolve(fullPath);
      const resolvedExtractDir = path.resolve(extractDir);
      
      if (!resolvedPath.startsWith(resolvedExtractDir)) {
        console.error(`[Security] Path traversal attempt blocked: ${entryPath}`);
        entry.autodrain();
        return;
      }
      
      // Security check 2: File count limit
      fileCount++;
      if (fileCount > MAX_FILES_COUNT) {
        extractionStream.destroy();
        reject(new Error(`ZIP contains too many files (max ${MAX_FILES_COUNT})`));
        return;
      }
      
      // Security check 3: Validate file extensions
      const ext = path.extname(entryPath).toLowerCase();
      if (entryType === 'File' && !ALLOWED_EXTENSIONS.includes(ext)) {
        console.warn(`[Security] Skipping file with disallowed extension: ${entryPath}`);
        entry.autodrain();
        return;
      }
      
      if (entryType === 'Directory') {
        await fs.promises.mkdir(fullPath, { recursive: true });
        entry.autodrain();
      } else {
        // Security check 4: Size tracking for ZIP bomb protection
        const chunks = [];
        
        entry.on('data', (chunk) => {
          totalSize += chunk.length;
          
          if (totalSize > MAX_EXTRACT_SIZE) {
            extractionStream.destroy();
            reject(new Error(`Extracted size exceeds limit (${MAX_EXTRACT_SIZE} bytes)`));
            return;
          }
          
          chunks.push(chunk);
        });
        
        entry.on('end', async () => {
          try {
            const dir = path.dirname(fullPath);
            await fs.promises.mkdir(dir, { recursive: true });
            await fs.promises.writeFile(fullPath, Buffer.concat(chunks));
            extractedFiles.push(entryPath);
          } catch (err) {
            reject(err);
          }
        });
      }
    });
    
    extractionStream.on('close', () => {
      resolve({
        success: true,
        fileCount,
        totalSize,
        files: extractedFiles
      });
    });
    
    extractionStream.on('error', (error) => {
      reject(error);
    });
  });
}

// Routes
router.post('/upload', authenticateToken, upload.single('model'), async (req, res) => {
  let extractDir = null;
  
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const uploadedFile = req.file;
    extractDir = path.join(UPLOAD_DIR, uuidv4());

    // Create extraction directory
    await fs.promises.mkdir(extractDir, { recursive: true });
    
    // Secure ZIP extraction
    console.log('[Security] Starting secure ZIP extraction...');
    const extractionResult = await secureExtractZip(uploadedFile.path, extractDir);
    console.log(`[Security] Extracted ${extractionResult.fileCount} files (${extractionResult.totalSize} bytes)`);

    // Validate extracted model
    const validation = await Live2DModelValidator.validateModel(extractDir);
    
    if (!validation.valid) {
      // Cleanup on validation failure
      await fs.promises.rm(extractDir, { recursive: true, force: true });
      await fs.promises.unlink(uploadedFile.path);
      
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    // Move to models directory with proper name
    const finalModelPath = path.join(MODELS_DIR, validation.modelPath);
    
    // Check if model already exists
    if (fs.existsSync(finalModelPath)) {
      await fs.promises.rm(extractDir, { recursive: true, force: true });
      await fs.promises.unlink(uploadedFile.path);
      
      return res.status(409).json({
        success: false,
        error: 'Model already exists'
      });
    }

    await fs.promises.rename(extractDir, finalModelPath);
    
    // Cleanup uploaded zip
    await fs.promises.unlink(uploadedFile.path);

    // Log successful upload
    console.log(`[Security] Model uploaded successfully by user: ${req.user?.username || 'unknown'}`);

    res.json({
      success: true,
      data: {
        modelId: validation.modelPath,
        modelPath: `/models/${validation.modelPath}/${validation.modelPath}.model3.json`,
        capabilities: validation.capabilities,
        metadata: validation.metadata
      }
    });

  } catch (error) {
    console.error('Model upload error:', error);
    
    // Cleanup on error
    if (extractDir) {
      try {
        await fs.promises.rm(extractDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }
    
    if (req.file) {
      try {
        await fs.promises.unlink(req.file.path);
      } catch (cleanupError) {
        console.error('File cleanup error:', cleanupError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message || 'Server error during model upload'
    });
  }
});

router.get('/models', async (req, res) => {
  try {
    const modelDirs = await fs.promises.readdir(MODELS_DIR);
    const models = [];

    for (const dir of modelDirs) {
      const modelDirPath = path.join(MODELS_DIR, dir);
      const stat = await fs.promises.stat(modelDirPath);
      
      if (stat.isDirectory()) {
        try {
          const validation = await Live2DModelValidator.validateModel(modelDirPath);
          if (validation.valid) {
            models.push({
              id: validation.modelPath,
              name: validation.metadata.name,
              path: `/models/${validation.modelPath}/${validation.modelPath}.model3.json`,
              capabilities: validation.capabilities,
              metadata: validation.metadata
            });
          }
        } catch (error) {
          console.warn(`Skipping invalid model ${dir}:`, error.message);
        }
      }
    }

    res.json({
      success: true,
      data: models
    });

  } catch (error) {
    console.error('Error listing models:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list models'
    });
  }
});

router.delete('/models/:modelId', authenticateToken, async (req, res) => {
  try {
    const { modelId } = req.params;
    
    // Security: Validate modelId to prevent path traversal
    if (!modelId || !/^[a-zA-Z0-9_-]+$/.test(modelId)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid model ID format'
      });
    }
    
    const modelPath = path.join(MODELS_DIR, modelId);
    
    // Security: Verify resolved path is within MODELS_DIR
    const resolvedPath = path.resolve(modelPath);
    const resolvedModelsDir = path.resolve(MODELS_DIR);
    
    if (!resolvedPath.startsWith(resolvedModelsDir)) {
      console.error(`[Security] Path traversal attempt in delete: ${modelId}`);
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
    
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({
        success: false,
        error: 'Model not found'
      });
    }

    await fs.promises.rm(modelPath, { recursive: true, force: true });
    
    console.log(`[Security] Model deleted by user: ${req.user?.username || 'unknown'} - ${modelId}`);
    
    res.json({
      success: true,
      message: 'Model deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete model'
    });
  }
});

module.exports = router;