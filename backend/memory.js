const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const config = require('../config.json');
const logger = require('./utils/logger');

class MemoryManager {
    constructor() {
        this.dbPath = path.join(__dirname, '../data/memory.json');
        this.db = null;
        this.maxWindow = config.memory.maxContextWindow;
        this.retrievalLimit = config.memory.retrievalLimit;
    }

    initialize() {
        const fs = require('fs');
        const dataDir = path.dirname(this.dbPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        const adapter = new FileSync(this.dbPath);
        this.db = low(adapter);

        // Set defaults
        this.db.defaults({ conversations: [], messages: [] })
            .write();

        logger.info('Memory database initialized', { path: this.dbPath });
    }

    async createConversation(title = 'New Conversation') {
        const { v4: uuidv4 } = require('uuid');
        const id = uuidv4();

        const conversation = {
            id,
            title,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        this.db.get('conversations')
            .push(conversation)
            .write();

        return conversation;
    }

    async addMessage(conversationId, role, content, importance = 0.5) {
        const { v4: uuidv4 } = require('uuid');
        const id = uuidv4();

        const message = {
            id,
            conversation_id: conversationId,
            role,
            content,
            importance,
            created_at: new Date().toISOString()
        };

        this.db.get('messages')
            .push(message)
            .write();

        // Update conversation timestamp
        this.db.get('conversations')
            .find({ id: conversationId })
            .assign({ updated_at: new Date().toISOString() })
            .write();

        return message;
    }

    async getRecentMessages(conversationId, limit = 10) {
        const messages = this.db.get('messages')
            .filter({ conversation_id: conversationId })
            .sortBy('created_at')
            .value();

        // take last N
        return messages.slice(-limit);
    }

    async searchRelevantContext(conversationId, query, limit = 5) {
        // Simple text search
        const terms = query.toLowerCase().split(' ');

        const messages = this.db.get('messages')
            .filter({ conversation_id: conversationId })
            .filter(msg => {
                const content = msg.content.toLowerCase();
                return terms.some(term => content.includes(term));
            })
            .sortBy('created_at') // Ideal would be importance + relevance
            .takeRight(limit)     // Simplified
            .value();

        return messages;
    }

    async getContextWindow(conversationId) {
        // Get recent messages
        // Lowdb filter returns LodashWrapper, value() gives array
        const allMessages = this.db.get('messages')
            .filter({ conversation_id: conversationId })
            .sortBy('created_at')
            .value();

        const reversed = [...allMessages].reverse();

        let tokenCount = 0;
        const window = [];

        for (const msg of reversed) {
            const estimate = msg.content.length / 4;
            if (tokenCount + estimate > this.maxWindow) break;

            window.unshift({ // Add to front to maintain order
                role: msg.role,
                content: msg.content
            });
            tokenCount += estimate;
            if (window.length >= 20) break; // Hard limit message count too
        }

        return window;
    }

    async updateImportance(messageId, importance) {
        this.db.get('messages')
            .find({ id: messageId })
            .assign({ importance })
            .write();
    }

    async deleteConversation(conversationId) {
        this.db.get('messages')
            .remove({ conversation_id: conversationId })
            .write();

        this.db.get('conversations')
            .remove({ id: conversationId })
            .write();
    }

    async getAllConversations() {
        // Warning: this could be slow if many messages
        const conversations = this.db.get('conversations')
            .sortBy('updated_at')
            .reverse() // Newest first
            .value();

        return conversations.map(c => {
            const lastMsg = this.db.get('messages')
                .filter({ conversation_id: c.id })
                .last()
                .value();

            return {
                ...c,
                last_message: lastMsg ? lastMsg.content : ''
            };
        });
    }

    async getConversationStats() {
        return {
            totalMessages: this.db.get('messages').size().value(),
            totalConversations: this.db.get('conversations').size().value()
        };
    }

    close() {
        // lowdb sync adapter doesn't need close
    }
}

const memoryManager = new MemoryManager();

module.exports = memoryManager;
