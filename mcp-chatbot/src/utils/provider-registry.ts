/**
 * Provider Registry
 *
 * Loads provider configurations from providers.json and maps
 * response format strings to parser functions. Adding a new
 * provider is a config-only change for standard formats (json).
 * Custom formats need a parser added to RESPONSE_PARSERS.
 */

import { extractByPath } from './jsonpath.js';
import { createLogger } from './logger.js';
import providersConfig from '../config/providers.json' with { type: 'json' };

const log = createLogger('provider-registry');

// ─── Types ────────────────────────────────────────────────

export interface ProviderAuth {
    type: 'bearer' | 'api_key' | 'cookie';
    /** Environment variable name holding the token */
    tokenEnvVar?: string;
    /** Static token value (fallback if env var not set) */
    token?: string;
}

export interface ProviderConfig {
    /** Base URL for resolving relative source paths */
    baseUrl: string;
    /** The API endpoint to call */
    apiEndpoint: string;
    /** Parser key — must match a key in RESPONSE_PARSERS */
    responseFormat: string;
    /** Static fields merged into the request body */
    requestTemplate?: Record<string, unknown>;
    /** Custom HTTP headers sent with every request */
    headers?: Record<string, string>;
    /** Auth configuration (optional) */
    auth?: ProviderAuth;
    /** JSONPath to extract answer (for "json" responseFormat) */
    responsePath?: string;
    /** JSONPath to extract sources (for "json" responseFormat) */
    sourcesPath?: string;
}

export interface ParsedResponse {
    answer: string;
    sources: Array<{ title: string; url: string }>;
}

type ResponseParser = (text: string, baseUrl: string) => ParsedResponse;

// ─── Vercel AI Data Stream Parser ─────────────────────────

/**
 * Parse Vercel AI Data Stream response.
 *
 * Line-based format with single-char prefix:
 *   0: — text content chunk (JSON string)
 *   9: — tool call initiation (JSON)
 *   a: — tool call result (JSON, may contain search results)
 *   f:, e:, d: — metadata/finish/done (skipped)
 */
export function parseVercelAIStream(text: string, baseUrl: string): ParsedResponse {
    const lines = text.split('\n').filter((l) => l.trim());
    let answer = '';
    const sources: Array<{ title: string; url: string }> = [];

    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx < 1) continue;

        const prefix = line.slice(0, colonIdx);
        const payload = line.slice(colonIdx + 1);

        try {
            switch (prefix) {
                case '0': {
                    const chunk = JSON.parse(payload);
                    if (typeof chunk === 'string') answer += chunk;
                    break;
                }
                case '9': {
                    // Tool call initiation — skip (we read results in 'a:')
                    break;
                }
                case 'a': {
                    const toolResult = JSON.parse(payload);
                    const results = toolResult?.result?.results;
                    if (Array.isArray(results)) {
                        for (const r of results) {
                            if (r.path) {
                                const url = r.path.startsWith('http')
                                    ? r.path
                                    : `${baseUrl}/${r.path.replace(/^\//, '')}`;
                                sources.push({
                                    title: r.metadata?.title || r.path,
                                    url,
                                });
                            }
                        }
                    }
                    break;
                }
            }
        } catch {
            // Non-JSON payload, skip
        }
    }

    return { answer, sources };
}

// ─── JSON Response Parser ─────────────────────────────────

/**
 * Parse a standard JSON chatbot response using JSONPath extraction.
 * Uses the provider's responsePath/sourcesPath for extraction.
 */
function createJsonParser(responsePath: string, sourcesPath: string): ResponseParser {
    return (text: string, _baseUrl: string): ParsedResponse => {
        let body: unknown;
        try {
            body = JSON.parse(text);
        } catch {
            return { answer: '', sources: [] };
        }

        const rawAnswer = extractByPath(body, responsePath);
        const answer = typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer || '');

        const rawSources = extractByPath(body, sourcesPath);
        const sources: Array<{ title: string; url: string }> = [];

        if (Array.isArray(rawSources)) {
            for (const item of rawSources) {
                if (typeof item === 'string') {
                    sources.push({ title: item, url: item });
                } else if (typeof item === 'object' && item !== null) {
                    const obj = item as Record<string, unknown>;
                    sources.push({
                        title: (obj.title as string) || (obj.url as string) || '',
                        url: (obj.url as string) || (obj.href as string) || '',
                    });
                }
            }
        }

        return { answer, sources: sources.filter((s) => s.url) };
    };
}

// ─── Parser Registry ──────────────────────────────────────

const RESPONSE_PARSERS: Record<string, ResponseParser> = {
    'vercel-ai-stream': parseVercelAIStream,
};

// ─── Provider Registry ────────────────────────────────────

const providers = new Map<string, ProviderConfig>();

// Load providers from JSON config at import time
for (const [name, config] of Object.entries(providersConfig)) {
    providers.set(name, config as unknown as ProviderConfig);
    log.debug('Registered provider', { name, endpoint: (config as any).apiEndpoint });
}

log.info('Provider registry loaded', { providerCount: providers.size, providers: [...providers.keys()] });

/**
 * Get a provider config by name
 */
export function getProvider(name: string): ProviderConfig | null {
    return providers.get(name) || null;
}

/**
 * Get list of all registered provider names
 */
export function getAvailableProviders(): string[] {
    return [...providers.keys()];
}

/**
 * Get the response parser function for a provider
 */
export function getResponseParser(config: ProviderConfig): ResponseParser {
    const parser = RESPONSE_PARSERS[config.responseFormat];
    if (parser) return parser;

    // For "json" format, create a parser from the provider's JSONPath config
    if (config.responseFormat === 'json') {
        return createJsonParser(
            config.responsePath || '$.answer',
            config.sourcesPath || '$.sources'
        );
    }

    log.warn('Unknown response format, falling back to json parser', { format: config.responseFormat });
    return createJsonParser('$.answer', '$.sources');
}

/**
 * Build the fetch request (url + RequestInit) for a provider
 */
export function buildProviderRequest(
    config: ProviderConfig,
    query: string
): { url: string; init: RequestInit } {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(config.headers || {}),
    };

    // Apply auth
    if (config.auth) {
        const token = config.auth.tokenEnvVar
            ? process.env[config.auth.tokenEnvVar] || config.auth.token || ''
            : config.auth.token || '';

        if (token) {
            switch (config.auth.type) {
                case 'bearer':
                    headers['Authorization'] = `Bearer ${token}`;
                    break;
                case 'api_key':
                    headers['X-API-Key'] = token;
                    break;
                case 'cookie':
                    headers['Cookie'] = token;
                    break;
            }
        }
    }

    // Build body: merge request template + standard message format
    const body: Record<string, unknown> = {
        ...(config.requestTemplate || {}),
        messages: [
            {
                id: `mcp-${Date.now().toString(36)}`,
                createdAt: new Date().toISOString(),
                role: 'user',
                content: query,
                parts: [{ type: 'text', text: query }],
            },
        ],
    };

    return {
        url: config.apiEndpoint,
        init: {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        },
    };
}
