import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chatAnswerWithSources } from '../src/tools/chat-answer-with-sources.js';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock content extraction
vi.mock('../src/tools/crawl.js', () => ({
    crawl: vi.fn(),
}));

// Mock the provider registry
const mockGetProvider = vi.fn();
const mockGetAvailableProviders = vi.fn();
const mockGetResponseParser = vi.fn();
const mockBuildProviderRequest = vi.fn();

vi.mock('../src/utils/provider-registry.js', () => ({
    getProvider: (...args: any[]) => mockGetProvider(...args),
    getAvailableProviders: (...args: any[]) => mockGetAvailableProviders(...args),
    getResponseParser: (...args: any[]) => mockGetResponseParser(...args),
    buildProviderRequest: (...args: any[]) => mockBuildProviderRequest(...args),
}));

import { crawl } from '../src/tools/crawl.js';
const mockExtract = vi.mocked(crawl);

// Inline Vercel AI stream parser for tests
function testParseStream(text: string, baseUrl: string) {
    const lines = text.split('\n').filter((l: string) => l.trim());
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
                case 'a': {
                    const toolResult = JSON.parse(payload);
                    const results = toolResult?.result?.results;
                    if (Array.isArray(results)) {
                        for (const r of results) {
                            if (r.path) {
                                const url = r.path.startsWith('http')
                                    ? r.path
                                    : `${baseUrl}/${r.path.replace(/^\//, '')}`;
                                sources.push({ title: r.metadata?.title || r.path, url });
                            }
                        }
                    }
                    break;
                }
            }
        } catch { /* skip */ }
    }
    return { answer, sources };
}

const MINTLIFY_CONFIG = {
    baseUrl: 'https://docs.elementum.io',
    apiEndpoint: 'https://leaves.mintlify.com/api/assistant/elementum/message',
    responseFormat: 'vercel-ai-stream',
    requestTemplate: { id: 'elementum', fp: 'elementum', currentPath: '/' },
    headers: { Origin: 'https://docs.elementum.io', Referer: 'https://docs.elementum.io/' },
};

// Helper: build a Vercel AI data stream response body
function buildStreamBody(answer: string, sourcePaths: string[]): string {
    const lines: string[] = [];
    lines.push('f:{"messageId":"msg-abc123"}');
    if (sourcePaths.length > 0) {
        lines.push('9:{"toolCallId":"call-1","toolName":"search","args":{"query":"test"}}');
        const results = sourcePaths.map((p) => ({
            path: p,
            metadata: { title: p.replace(/\//g, ' ').trim() },
        }));
        lines.push(`a:{"toolCallId":"call-1","result":{"results":${JSON.stringify(results)}}}`);
    }
    for (const chunk of answer.split(' ')) {
        lines.push(`0:${JSON.stringify(chunk + ' ')}`);
    }
    lines.push('e:{"finishReason":"stop","usage":{"promptTokens":100,"completionTokens":50}}');
    lines.push('d:{"finishReason":"stop"}');
    return lines.join('\n');
}

describe('chatAnswerWithSources', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mockGetProvider.mockImplementation((name: string) =>
            name === 'mintlify' ? MINTLIFY_CONFIG : null
        );
        mockGetAvailableProviders.mockReturnValue(['mintlify']);
        mockGetResponseParser.mockReturnValue(testParseStream);
        mockBuildProviderRequest.mockImplementation((_config: any, query: string) => ({
            url: 'https://leaves.mintlify.com/api/assistant/elementum/message',
            init: {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ messages: [{ role: 'user', content: query }] }),
            },
        }));
    });

    it('should return error for unknown provider', async () => {
        const result = await chatAnswerWithSources({
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

        const result = await chatAnswerWithSources({
            query: 'What are workflows?',
            provider: 'mintlify',
        });

        expect(result.answer).toContain('Workflows');
        expect(result.answer).toContain('automate');
        expect(result.sources).toHaveLength(2);
        expect(result.sources[0].title).toBe('Welcome to Elementum');
        expect(result.sources[0].markdown).toContain('# Welcome');
        expect(result.sources[1].title).toBe('Workflow Layouts');
        expect(result.metadata.provider).toBe('mintlify');
        expect(result.metadata.sources_found).toBe(2);
        expect(result.metadata.sources_extracted).toBe(2);
        expect(result.error).toBeUndefined();

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

        const result = await chatAnswerWithSources({
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

        const result = await chatAnswerWithSources({
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

        const result = await chatAnswerWithSources({
            query: 'test',
            provider: 'mintlify',
        });

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
