import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatbotQueryWithSources } from '../src/tools/chatbot-with-sources.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock content extraction
vi.mock('../src/tools/content-extract.js', () => ({
    sourceContentExtraction: vi.fn(),
}));

import { sourceContentExtraction } from '../src/tools/content-extract.js';
const mockExtract = vi.mocked(sourceContentExtraction);

// Helper: build a Vercel AI data stream response body
function buildStreamBody(answer: string, sourcePaths: string[]): string {
    const lines: string[] = [];

    // Metadata
    lines.push('f:{"messageId":"msg-abc123"}');

    // Tool call + result with sources
    if (sourcePaths.length > 0) {
        lines.push('9:{"toolCallId":"call-1","toolName":"search","args":{"query":"test"}}');
        const results = sourcePaths.map((p) => ({
            path: p,
            metadata: { title: p.replace(/\//g, ' ').trim() },
        }));
        lines.push(`a:{"toolCallId":"call-1","result":{"results":${JSON.stringify(results)}}}`);
    }

    // Text chunks
    for (const chunk of answer.split(' ')) {
        lines.push(`0:${JSON.stringify(chunk + ' ')}`);
    }

    // Done
    lines.push('e:{"finishReason":"stop","usage":{"promptTokens":100,"completionTokens":50}}');
    lines.push('d:{"finishReason":"stop"}');

    return lines.join('\n');
}

describe('chatbotQueryWithSources', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return error for unknown provider', async () => {
        const result = await chatbotQueryWithSources({
            query: 'What is X?',
            provider: 'unknown_provider',
        });

        expect(result.error).toContain('Unknown provider');
        expect(result.answer).toBe('');
        expect(result.sources).toEqual([]);
    });

    it('should query chatbot, extract sources, and return full content', async () => {
        const streamBody = buildStreamBody('Workflows automate business processes.', [
            'getting-started/welcome-to-elementum',
            'workflows/layouts',
        ]);

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(streamBody),
        });

        mockExtract.mockResolvedValue({
            sources: [
                {
                    url: 'https://docs.elementum.io/getting-started/welcome-to-elementum',
                    title: 'Welcome to Elementum',
                    markdown: '# Welcome\n\nElementum is a platform...',
                    media: [],
                    content_length: 35,
                    status: 'success',
                },
                {
                    url: 'https://docs.elementum.io/workflows/layouts',
                    title: 'Workflow Layouts',
                    markdown: '# Layouts\n\nWorkflow components...',
                    media: [],
                    content_length: 31,
                    status: 'success',
                },
            ],
            total_media_count: 0,
        });

        const result = await chatbotQueryWithSources({
            query: 'What are workflows?',
            provider: 'mintlify',
        });

        // Answer was assembled from stream chunks
        expect(result.answer).toContain('Workflows');
        expect(result.answer).toContain('automate');

        // Sources extracted and fetched
        expect(result.sources).toHaveLength(2);
        expect(result.sources[0].title).toBe('Welcome to Elementum');
        expect(result.sources[0].markdown).toContain('# Welcome');
        expect(result.sources[1].title).toBe('Workflow Layouts');

        // Metadata
        expect(result.metadata.provider).toBe('mintlify');
        expect(result.metadata.sources_found).toBe(2);
        expect(result.metadata.sources_extracted).toBe(2);
        expect(result.metadata.query_time_ms).toBeGreaterThanOrEqual(0);
        expect(result.metadata.total_time_ms).toBeGreaterThanOrEqual(0);
        expect(result.error).toBeUndefined();

        // Verify extraction was called with correct URLs
        expect(mockExtract).toHaveBeenCalledWith(
            expect.objectContaining({
                urls: [
                    'https://docs.elementum.io/getting-started/welcome-to-elementum',
                    'https://docs.elementum.io/workflows/layouts',
                ],
            })
        );
    });

    it('should handle chatbot HTTP error', async () => {
        mockFetch.mockResolvedValue({
            ok: false,
            status: 500,
            text: () => Promise.resolve('Internal Server Error'),
        });

        const result = await chatbotQueryWithSources({
            query: 'test',
            provider: 'mintlify',
        });

        expect(result.error).toContain('HTTP 500');
        expect(result.answer).toBe('');
        expect(result.sources).toEqual([]);
        expect(mockExtract).not.toHaveBeenCalled();
    });

    it('should handle chatbot response with no sources', async () => {
        const streamBody = buildStreamBody('I could not find relevant information.', []);

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(streamBody),
        });

        const result = await chatbotQueryWithSources({
            query: 'Something obscure',
            provider: 'mintlify',
        });

        expect(result.answer).toContain('could not find');
        expect(result.sources).toEqual([]);
        expect(result.metadata.sources_found).toBe(0);
        expect(mockExtract).not.toHaveBeenCalled();
    });

    it('should deduplicate source URLs', async () => {
        const streamBody = buildStreamBody('Answer here.', [
            'getting-started/welcome-to-elementum',
            'getting-started/welcome-to-elementum', // duplicate
            'workflows/layouts',
        ]);

        mockFetch.mockResolvedValue({
            ok: true,
            status: 200,
            text: () => Promise.resolve(streamBody),
        });

        mockExtract.mockResolvedValue({
            sources: [
                { url: 'https://docs.elementum.io/getting-started/welcome-to-elementum', title: 'Welcome', markdown: '# Welcome', media: [], content_length: 10, status: 'success' },
                { url: 'https://docs.elementum.io/workflows/layouts', title: 'Layouts', markdown: '# Layouts', media: [], content_length: 10, status: 'success' },
            ],
            total_media_count: 0,
        });

        const result = await chatbotQueryWithSources({
            query: 'test',
            provider: 'mintlify',
        });

        // Should pass only 2 unique URLs to extraction, not 3
        expect(mockExtract).toHaveBeenCalledWith(
            expect.objectContaining({
                urls: [
                    'https://docs.elementum.io/getting-started/welcome-to-elementum',
                    'https://docs.elementum.io/workflows/layouts',
                ],
            })
        );
        expect(result.metadata.sources_found).toBe(2);
    });
});
