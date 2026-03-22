/**
 * Chatbot Query With Sources Tool
 *
 * Combined pipeline that:
 *   1. Queries an external chatbot API via a configured provider
 *   2. Parses the response to extract source/citation URLs
 *   3. Fetches full markdown content from each source URL
 *
 * Provider configuration is loaded from src/config/providers.json
 * via the provider registry.
 */

import { createLogger } from '../utils/logger.js';
import {
    getProvider,
    getAvailableProviders,
    getResponseParser,
    buildProviderRequest,
} from '../utils/provider-registry.js';
import { crawl } from './crawl.js';

const log = createLogger('chatbot-with-sources');

// ─── Tool Params & Result ─────────────────────────────────

export interface ChatbotWithSourcesParams {
    /** The query to send */
    query: string;
    /** Provider name (must match a key in providers.json) */
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

export async function chatAnswerWithSources(
    params: ChatbotWithSourcesParams
): Promise<ChatbotWithSourcesResult> {
    const {
        query,
        provider,
        content_selector = '#content',
        max_content_length = 50000,
        timeout_ms = 30000,
    } = params;

    // Look up provider from registry
    const config = getProvider(provider);
    if (!config) {
        const available = getAvailableProviders().join(', ');
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

    const { url, init } = buildProviderRequest(config, query);
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

    // Step 2: Parse response using the provider's parser
    const parser = getResponseParser(config);
    const parsed = parser(rawText, config.baseUrl);

    log.info('Chatbot answered', {
        answerLength: parsed.answer.length,
        sourcesFound: parsed.sources.length,
        queryTimeMs,
    });

    // Step 3: Deduplicate source URLs
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

    // Step 4: Fetch full markdown from each source
    log.info('Extracting source content', { urlCount: uniqueUrls.length });
    const extractStart = Date.now();

    const extractResult = await crawl({
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
