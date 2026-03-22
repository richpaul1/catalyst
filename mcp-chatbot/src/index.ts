#!/usr/bin/env node

/**
 * MCP Chatbot Server
 *
 * An MCP server exposing three tools for external chatbot integration:
 *   1. external_chatbot_query       — Query an external chatbot API
 *   2. source_content_extraction    — Fetch HTML pages and extract raw markdown with media
 *   3. chatbot_query_with_sources   — Combined: query chatbot → extract source URLs → fetch full markdown
 *
 * Transport: stdio (spawned by the platform's MCP tool executor)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { externalChatbotQuery } from './tools/chatbot-query.js';
import { sourceContentExtraction } from './tools/content-extract.js';
import { chatbotQueryWithSources } from './tools/chatbot-with-sources.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('server');

const server = new McpServer({
    name: 'mcp-chatbot',
    version: '1.0.0',
});

// ==================== Tool 1: external_chatbot_query ====================

server.tool(
    'external_chatbot_query',
    'Send a query to an external chatbot API (e.g., Mintlify, Intercom) and return the answer text along with any cited source URLs.',
    {
        chatbot_url: z.string().url().describe('The chatbot API endpoint URL'),
        query: z.string().describe('The query to send to the chatbot'),
        auth_type: z.enum(['none', 'api_key', 'bearer', 'cookie']).default('none').describe('Authentication type'),
        auth_token: z.string().default('').describe('Authentication token (API key, bearer token, or cookie value)'),
        request_template: z.record(z.string(), z.unknown()).optional().describe('JSON request body template with {{query}} placeholder. If omitted, uses default chat message format.'),
        response_path: z.string().default('$.answer').describe('JSONPath to extract the answer text from the response'),
        sources_path: z.string().default('$.sources').describe('JSONPath to extract source URLs from the response'),
        headers: z.record(z.string(), z.string()).optional().describe('Custom HTTP headers'),
        timeout_ms: z.number().default(30000).describe('Request timeout in milliseconds'),
    },
    async (params) => {
        log.info('external_chatbot_query called', { url: (params as any).chatbot_url, query: (params as any).query });
        const start = Date.now();
        try {
            const result = await externalChatbotQuery(params as any);
            log.info('external_chatbot_query completed', {
                durationMs: Date.now() - start,
                statusCode: result.metadata.status_code,
                sourcesCount: result.sources.length,
                hasError: !!result.error,
            });
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            log.error('external_chatbot_query failed', {
                durationMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
);

// ==================== Tool 2: source_content_extraction ====================

server.tool(
    'source_content_extraction',
    'Fetch HTML pages from given URLs and convert them to raw markdown, preserving all image and video references. Use this to extract rich content (with media) from documentation pages.',
    {
        urls: z.array(z.string().url()).describe('URLs to fetch and convert to markdown'),
        content_selector: z.string().optional().describe('CSS selector to isolate main content (e.g., "article", ".content-area")'),
        strip_navigation: z.boolean().default(true).describe('Strip nav, header, footer, sidebar elements'),
        preserve_media: z.boolean().default(true).describe('Preserve image and video references in markdown output'),
        media_base_url: z.string().default('').describe('Base URL to resolve relative image/video paths'),
        max_content_length: z.number().default(50000).describe('Max characters per source page'),
        timeout_ms: z.number().default(30000).describe('Request timeout per page in milliseconds'),
    },
    async (params) => {
        log.info('source_content_extraction called', { urlCount: params.urls.length, urls: params.urls });
        const start = Date.now();
        try {
            const result = await sourceContentExtraction(params);
            log.info('source_content_extraction completed', {
                durationMs: Date.now() - start,
                pagesExtracted: result.sources.length,
                totalMedia: result.total_media_count,
                succeeded: result.sources.filter((s) => s.status === 'success').length,
            });
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            log.error('source_content_extraction failed', {
                durationMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
);

// ==================== Tool 3: chatbot_query_with_sources ====================

server.tool(
    'chatbot_query_with_sources',
    'Query an external chatbot (e.g., Mintlify on docs.elementum.io), extract the cited source URLs from its response, then fetch and return the full markdown content from each source page. Returns both the chatbot answer and complete source documentation.',
    {
        query: z.string().describe('The question to ask the chatbot'),
        provider: z.string().default('mintlify').describe('Chatbot provider name (currently: "mintlify")'),
        content_selector: z.string().default('article').describe('CSS selector to isolate main content on source pages'),
        max_content_length: z.number().default(50000).describe('Max characters per source page'),
        timeout_ms: z.number().default(30000).describe('Request timeout in milliseconds'),
    },
    async (params) => {
        log.info('chatbot_query_with_sources called', { provider: params.provider, query: params.query });
        const start = Date.now();
        try {
            const result = await chatbotQueryWithSources(params);
            log.info('chatbot_query_with_sources completed', {
                durationMs: Date.now() - start,
                sourcesFound: result.metadata.sources_found,
                sourcesExtracted: result.metadata.sources_extracted,
                hasError: !!result.error,
            });
            return {
                content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
            };
        } catch (err) {
            log.error('chatbot_query_with_sources failed', {
                durationMs: Date.now() - start,
                error: err instanceof Error ? err.message : String(err),
            });
            throw err;
        }
    }
);

// ==================== Start Server ====================

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log.info('MCP Chatbot server started', { transport: 'stdio' });
}

main().catch((error) => {
    log.error('Failed to start MCP Chatbot server', { error: error instanceof Error ? error.message : String(error) });
    process.exit(1);
});
