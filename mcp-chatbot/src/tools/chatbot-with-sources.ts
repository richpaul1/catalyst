/**
 * Chatbot Query With Sources Tool
 *
 * Combined pipeline that:
 *   1. Queries an external chatbot API (e.g., Mintlify)
 *   2. Parses the response to extract source/citation URLs
 *   3. Fetches full markdown content from each source URL
 *
 * Returns both the chatbot answer and the full source content.
 */

import { createLogger } from '../utils/logger.js';
import { sourceContentExtraction } from './content-extract.js';

const log = createLogger('chatbot-with-sources');

// ─── Vercel AI Data Stream Parser ─────────────────────────

interface ParsedStream {
    answer: string;
    sources: Array<{ title: string; url: string }>;
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
}

/**
 * Parse Vercel AI Data Stream response.
 *
 * Line-based format with single-char prefix:
 *   0: — text content chunk (JSON string)
 *   9: — tool call initiation (JSON)
 *   a: — tool call result (JSON, may contain search results)
 *   f:, e:, d: — metadata/finish/done (skipped)
 */
function parseVercelAIStream(text: string): ParsedStream {
    const lines = text.split('\n').filter((l) => l.trim());
    let answer = '';
    const sources: Array<{ title: string; url: string }> = [];
    const toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];

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
                    const toolCall = JSON.parse(payload);
                    if (toolCall.toolName) {
                        toolCalls.push({ toolName: toolCall.toolName, args: toolCall.args || {} });
                    }
                    break;
                }
                case 'a': {
                    const toolResult = JSON.parse(payload);
                    const results = toolResult?.result?.results;
                    if (Array.isArray(results)) {
                        for (const r of results) {
                            if (r.path) {
                                sources.push({
                                    title: r.metadata?.title || r.path,
                                    url: r.path,
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

    return { answer, sources, toolCalls };
}

// ─── Chatbot Provider Configs ─────────────────────────────

interface ProviderConfig {
    /** Build the fetch request for this provider */
    buildRequest(query: string): { url: string; init: RequestInit };
    /** Parse the response into answer + source URLs */
    parseResponse(text: string, baseUrl: string): ParsedStream;
    /** Base URL for resolving relative source paths */
    baseUrl: string;
}

const PROVIDERS: Record<string, ProviderConfig> = {
    mintlify: {
        baseUrl: 'https://docs.elementum.io',
        buildRequest(query: string) {
            return {
                url: 'https://leaves.mintlify.com/api/assistant/elementum/message',
                init: {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Origin: 'https://docs.elementum.io',
                        Referer: 'https://docs.elementum.io/',
                    },
                    body: JSON.stringify({
                        id: 'elementum',
                        messages: [
                            {
                                id: `mcp-${Date.now().toString(36)}`,
                                createdAt: new Date().toISOString(),
                                role: 'user',
                                content: query,
                                parts: [{ type: 'text', text: query }],
                            },
                        ],
                        fp: 'elementum',
                        currentPath: '/',
                    }),
                },
            };
        },
        parseResponse(text: string, baseUrl: string): ParsedStream {
            const parsed = parseVercelAIStream(text);
            // Resolve relative paths to absolute URLs
            parsed.sources = parsed.sources.map((s) => ({
                title: s.title,
                url: s.url.startsWith('http') ? s.url : `${baseUrl}/${s.url.replace(/^\//, '')}`,
            }));
            return parsed;
        },
    },
};

// ─── Tool Params & Result ─────────────────────────────────

export interface ChatbotWithSourcesParams {
    /** The query to send */
    query: string;
    /** Provider name (currently: 'mintlify') */
    provider: string;
    /** CSS selector to isolate content on source pages */
    content_selector?: string;
    /** Max characters per source page */
    max_content_length?: number;
    /** Request timeout in ms */
    timeout_ms?: number;
}

export interface ChatbotWithSourcesResult {
    /** The chatbot's answer text */
    answer: string;
    /** Source pages with full markdown content */
    sources: Array<{
        url: string;
        title: string;
        markdown: string;
        content_length: number;
        status: string;
    }>;
    /** Summary stats */
    metadata: {
        provider: string;
        query_time_ms: number;
        extraction_time_ms: number;
        total_time_ms: number;
        sources_found: number;
        sources_extracted: number;
    };
    error?: string;
}

// ─── Implementation ───────────────────────────────────────

export async function chatbotQueryWithSources(
    params: ChatbotWithSourcesParams
): Promise<ChatbotWithSourcesResult> {
    const {
        query,
        provider,
        content_selector = 'article',
        max_content_length = 50000,
        timeout_ms = 30000,
    } = params;

    const config = PROVIDERS[provider];
    if (!config) {
        const available = Object.keys(PROVIDERS).join(', ');
        return {
            answer: '',
            sources: [],
            metadata: {
                provider,
                query_time_ms: 0,
                extraction_time_ms: 0,
                total_time_ms: 0,
                sources_found: 0,
                sources_extracted: 0,
            },
            error: `Unknown provider "${provider}". Available: ${available}`,
        };
    }

    const totalStart = Date.now();

    // Step 1: Query the chatbot
    log.info('Querying chatbot', { provider, query });
    const queryStart = Date.now();

    const { url, init } = config.buildRequest(query);
    const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout_ms),
    });

    const rawText = await response.text();
    const queryTimeMs = Date.now() - queryStart;

    if (!response.ok) {
        log.warn('Chatbot query failed', { provider, status: response.status });
        return {
            answer: '',
            sources: [],
            metadata: {
                provider,
                query_time_ms: queryTimeMs,
                extraction_time_ms: 0,
                total_time_ms: Date.now() - totalStart,
                sources_found: 0,
                sources_extracted: 0,
            },
            error: `Chatbot returned HTTP ${response.status}`,
        };
    }

    const parsed = config.parseResponse(rawText, config.baseUrl);
    log.info('Chatbot answered', {
        answerLength: parsed.answer.length,
        sourcesFound: parsed.sources.length,
        queryTimeMs,
    });

    // Step 2: Deduplicate source URLs
    const uniqueUrls = [...new Set(parsed.sources.map((s) => s.url))];

    if (uniqueUrls.length === 0) {
        return {
            answer: parsed.answer,
            sources: [],
            metadata: {
                provider,
                query_time_ms: queryTimeMs,
                extraction_time_ms: 0,
                total_time_ms: Date.now() - totalStart,
                sources_found: 0,
                sources_extracted: 0,
            },
        };
    }

    // Step 3: Fetch full markdown from each source
    log.info('Extracting source content', { urlCount: uniqueUrls.length });
    const extractStart = Date.now();

    const extractResult = await sourceContentExtraction({
        urls: uniqueUrls,
        content_selector,
        strip_navigation: true,
        preserve_media: true,
        media_base_url: config.baseUrl,
        max_content_length,
        timeout_ms,
    });

    const extractionTimeMs = Date.now() - extractStart;
    const succeeded = extractResult.sources.filter((s) => s.status === 'success').length;

    log.info('Pipeline complete', {
        sourcesFound: uniqueUrls.length,
        sourcesExtracted: succeeded,
        totalTimeMs: Date.now() - totalStart,
    });

    return {
        answer: parsed.answer,
        sources: extractResult.sources.map((s) => ({
            url: s.url,
            title: s.title,
            markdown: s.markdown,
            content_length: s.content_length,
            status: s.status,
        })),
        metadata: {
            provider,
            query_time_ms: queryTimeMs,
            extraction_time_ms: extractionTimeMs,
            total_time_ms: Date.now() - totalStart,
            sources_found: uniqueUrls.length,
            sources_extracted: succeeded,
        },
    };
}
