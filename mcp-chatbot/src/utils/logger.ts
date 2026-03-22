/**
 * Logger Utility
 *
 * Simple structured logger for the MCP chatbot server.
 * Writes to both stderr and a log file so logs are visible via `tail -f`.
 *
 * Config via env vars:
 *   LOG_LEVEL — debug | info | warn | error (default: info)
 *   LOG_FILE  — path to log file (default: mcp-chatbot/logs/mcp-chatbot.log)
 */

import { appendFileSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

// Resolve log file path relative to project root
const DEFAULT_LOG_PATH = resolve(
    dirname(new URL(import.meta.url).pathname),
    '../../logs/mcp-chatbot.log'
);
const logFilePath = process.env.LOG_FILE || DEFAULT_LOG_PATH;

// Ensure log directory exists
try {
    mkdirSync(dirname(logFilePath), { recursive: true });
} catch {
    // Directory may already exist
}

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
    return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function formatTimestamp(): string {
    return new Date().toISOString();
}

function log(level: LogLevel, component: string, message: string, data?: Record<string, unknown>): void {
    if (!shouldLog(level)) return;

    const entry = {
        ts: formatTimestamp(),
        level: LEVEL_LABELS[level],
        component,
        msg: message,
        ...(data && Object.keys(data).length > 0 ? data : {}),
    };

    const line = JSON.stringify(entry);

    // Write to stderr (for MCP protocol debugging)
    console.error(line);

    // Append to log file (for `tail -f` visibility)
    try {
        appendFileSync(logFilePath, line + '\n');
    } catch {
        // Silently fail if file write fails — don't crash the server
    }
}

/**
 * Create a scoped logger for a specific component.
 *
 * Usage:
 *   const log = createLogger('chatbot-query');
 *   log.info('Query received', { url: '...' });
 */
export function createLogger(component: string) {
    return {
        debug: (msg: string, data?: Record<string, unknown>) => log('debug', component, msg, data),
        info: (msg: string, data?: Record<string, unknown>) => log('info', component, msg, data),
        warn: (msg: string, data?: Record<string, unknown>) => log('warn', component, msg, data),
        error: (msg: string, data?: Record<string, unknown>) => log('error', component, msg, data),
    };
}

