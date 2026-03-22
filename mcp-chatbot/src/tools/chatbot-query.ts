/**
 * External Chatbot Query Tool
 *
 * Sends a query to an external chatbot API endpoint, parses the response
 * using JSONPath extraction, and returns the answer text along with any
 * cited source URLs.
 */

import { httpRequest, type AuthType } from '../utils/http-client.js';
import { extractByPath } from '../utils/jsonpath.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('chatbot-query');

export interface ChatbotQueryParams {
    /** The chatbot API endpoint URL */
    chatbot_url: string;
    /** The query to send to the chatbot */
    query: string;
    /** Authentication type */
    auth_type?: AuthType;
    /** Authentication token (API key, bearer token, or cookie) */
    auth_token?: string;
    /** JSON request body template with {{query}} placeholder */
    request_template?: Record<string, unknown>;
    /** JSONPath to extract the answer text from the response */
    response_path?: string;
    /** JSONPath to extract source URLs from the response */
    sources_path?: string;
    /** Custom HTTP headers */
    headers?: Record<string, string>;
    /** Request timeout in milliseconds */
    timeout_ms?: number;
}

export interface ChatbotSource {
    title: string;
    url: string;
}

export interface ChatbotQueryResult {
    answer: string;
    sources: ChatbotSource[];
    metadata: {
        response_time_ms: number;
        status_code: number;
    };
    error?: string;
}

/**
 * Render a request template by substituting {{query}} placeholders
 */
function renderTemplate(
    template: Record<string, unknown>,
    query: string
): Record<string, unknown> {
    const json = JSON.stringify(template);
    const rendered = json.replace(/\{\{query\}\}/g, query.replace(/"/g, '\\"'));
    return JSON.parse(rendered);
}

/**
 * Build the default request body when no template is provided
 */
function buildDefaultBody(query: string): Record<string, unknown> {
    return {
        messages: [{ role: 'user', content: query }],
    };
}

/**
 * Extract source references from the API response
 */
function extractSources(responseBody: unknown, sourcesPath: string): ChatbotSource[] {
    const rawSources = extractByPath(responseBody, sourcesPath);

    if (!rawSources) return [];

    // If the path resolves to an array of strings (URLs)
    if (Array.isArray(rawSources)) {
        return rawSources.map((item: unknown) => {
            if (typeof item === 'string') {
                return { title: item, url: item };
            }
            if (typeof item === 'object' && item !== null) {
                const obj = item as Record<string, unknown>;
                return {
                    title: (obj.title as string) || (obj.name as string) || (obj.url as string) || '',
                    url: (obj.url as string) || (obj.href as string) || (obj.link as string) || '',
                };
            }
            return { title: String(item), url: String(item) };
        }).filter((s) => s.url);
    }

    return [];
}

/**
 * Execute an external chatbot query
 */
export async function externalChatbotQuery(params: ChatbotQueryParams): Promise<ChatbotQueryResult> {
    const {
        chatbot_url,
        query,
        auth_type = 'none',
        auth_token,
        request_template,
        response_path = '$.answer',
        sources_path = '$.sources',
        headers = {},
        timeout_ms = 30000,
    } = params;

    // Build request body
    const body = request_template
        ? renderTemplate(request_template, query)
        : buildDefaultBody(query);

    log.debug('Sending request', { url: chatbot_url, authType: auth_type, hasTemplate: !!request_template });

    // Make the request
    const response = await httpRequest({
        url: chatbot_url,
        method: 'POST',
        body,
        headers,
        authType: auth_type,
        authToken: auth_token,
        timeoutMs: timeout_ms,
        retryOn5xx: true,
    });

    // Check for HTTP errors
    if (response.status >= 400 || response.status === 0) {
        const errorBody = response.body as Record<string, unknown>;
        const errorMsg = (errorBody?.error as string) || `HTTP ${response.status}`;
        log.warn('Request returned error', { statusCode: response.status, error: errorMsg, durationMs: response.responseTimeMs });
        return {
            answer: '',
            sources: [],
            metadata: {
                response_time_ms: response.responseTimeMs,
                status_code: response.status,
            },
            error: errorMsg,
        };
    }

    // Extract answer
    const rawAnswer = extractByPath(response.body, response_path);
    const answer = typeof rawAnswer === 'string' ? rawAnswer : JSON.stringify(rawAnswer || '');

    // Extract sources
    const sources = extractSources(response.body, sources_path);

    log.info('Query successful', {
        statusCode: response.status,
        durationMs: response.responseTimeMs,
        answerLength: answer.length,
        sourcesCount: sources.length,
    });

    return {
        answer,
        sources,
        metadata: {
            response_time_ms: response.responseTimeMs,
            status_code: response.status,
        },
    };
}
