/**
 * Structured Logger using Winston
 * Saves logs to files while keeping terminal clean for chat output
 */

const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const path = require('path');
const fs = require('fs');

// Ensure logs directory exists
const logsDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for file logs
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
);

// Create error log transport (errors only)
const errorTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxFiles: '14d',
    format: fileFormat
});

// Create combined log transport (all levels)
const combinedTransport = new DailyRotateFile({
    filename: path.join(logsDir, 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxFiles: '14d',
    format: fileFormat
});

// Handle transport errors
errorTransport.on('error', (error) => {
    console.error('Error transport failed:', error);
});

combinedTransport.on('error', (error) => {
    console.error('Combined transport failed:', error);
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { service: 'ai-companion-backend' },
    transports: [
        errorTransport,
        combinedTransport
    ]
});

// Add console transport only in development and for errors
if (process.env.NODE_ENV === 'development') {
    logger.add(new winston.transports.Console({
        level: 'error',
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// Helper methods for structured logging
logger.logRequest = (req, message, meta = {}) => {
    logger.info(message, {
        ...meta,
        ip: req.ip || req.connection?.remoteAddress,
        method: req.method,
        path: req.path
    });
};

logger.logError = (error, context = {}) => {
    logger.error(error.message, {
        ...context,
        stack: error.stack,
        name: error.name
    });
};

logger.logStream = (provider, event, meta = {}) => {
    logger.info(`[Stream] ${event}`, {
        ...meta,
        provider
    });
};

module.exports = logger;
