import { describe, it, expect } from 'vitest';
import {
    parseVercelAIStream,
    getProvider,
    getAvailableProviders,
    getResponseParser,
    buildProviderRequest,
} from '../src/utils/provider-registry.js';

describe('provider-registry', () => {
    describe('getProvider', () => {
        it('should return config for registered provider', () => {
            const config = getProvider('mintlify');
            expect(config).not.toBeNull();
            expect(config!.baseUrl).toBe('https://docs.elementum.io');
            expect(config!.apiEndpoint).toContain('mintlify.com');
            expect(config!.responseFormat).toBe('vercel-ai-stream');
        });

        it('should return null for unregistered provider', () => {
            expect(getProvider('nonexistent')).toBeNull();
        });
    });

    describe('getAvailableProviders', () => {
        it('should return list including mintlify', () => {
            const providers = getAvailableProviders();
            expect(providers).toContain('mintlify');
            expect(providers.length).toBeGreaterThanOrEqual(1);
        });
    });

    describe('getResponseParser', () => {
        it('should return vercel-ai-stream parser for mintlify', () => {
            const config = getProvider('mintlify')!;
            const parser = getResponseParser(config);
            expect(typeof parser).toBe('function');
        });

        it('should return json parser for json responseFormat', () => {
            const fakeConfig = {
                baseUrl: 'https://example.com',
                apiEndpoint: 'https://example.com/api',
                responseFormat: 'json',
                responsePath: '$.answer',
                sourcesPath: '$.sources',
            };
            const parser = getResponseParser(fakeConfig);
            expect(typeof parser).toBe('function');

            // Test the json parser
            const jsonResponse = JSON.stringify({
                answer: 'Hello from JSON',
                sources: [{ title: 'Doc 1', url: 'https://example.com/doc1' }],
            });
            const result = parser(jsonResponse, 'https://example.com');
            expect(result.answer).toBe('Hello from JSON');
            expect(result.sources).toHaveLength(1);
            expect(result.sources[0].url).toBe('https://example.com/doc1');
        });

        it('should fallback to json parser for unknown responseFormat', () => {
            const fakeConfig = {
                baseUrl: 'https://example.com',
                apiEndpoint: 'https://example.com/api',
                responseFormat: 'some-unknown-format',
            };
            const parser = getResponseParser(fakeConfig);
            expect(typeof parser).toBe('function');
        });
    });

    describe('buildProviderRequest', () => {
        it('should build correct request for mintlify provider', () => {
            const config = getProvider('mintlify')!;
            const { url, init } = buildProviderRequest(config, 'What is Elementum?');

            expect(url).toBe(config.apiEndpoint);
            expect(init.method).toBe('POST');

            const headers = init.headers as Record<string, string>;
            expect(headers['Content-Type']).toBe('application/json');
            expect(headers['Origin']).toBe('https://docs.elementum.io');

            const body = JSON.parse(init.body as string);
            expect(body.id).toBe('elementum');
            expect(body.fp).toBe('elementum');
            expect(body.messages).toHaveLength(1);
            expect(body.messages[0].content).toBe('What is Elementum?');
            expect(body.messages[0].role).toBe('user');
        });

        it('should apply bearer auth from config', () => {
            const config = {
                baseUrl: 'https://example.com',
                apiEndpoint: 'https://example.com/api/chat',
                responseFormat: 'json',
                auth: { type: 'bearer' as const, token: 'test-token-123' },
            };

            const { init } = buildProviderRequest(config, 'Hello');
            const headers = init.headers as Record<string, string>;
            expect(headers['Authorization']).toBe('Bearer test-token-123');
        });

        it('should apply api_key auth from config', () => {
            const config = {
                baseUrl: 'https://example.com',
                apiEndpoint: 'https://example.com/api/chat',
                responseFormat: 'json',
                auth: { type: 'api_key' as const, token: 'my-api-key' },
            };

            const { init } = buildProviderRequest(config, 'Hello');
            const headers = init.headers as Record<string, string>;
            expect(headers['X-API-Key']).toBe('my-api-key');
        });
    });

    describe('parseVercelAIStream', () => {
        it('should extract answer text from 0: lines', () => {
            const stream = [
                'f:{"messageId":"msg-1"}',
                '0:"Hello "',
                '0:"world!"',
                'e:{"finishReason":"stop"}',
            ].join('\n');

            const result = parseVercelAIStream(stream, 'https://docs.elementum.io');
            expect(result.answer).toBe('Hello world!');
            expect(result.sources).toEqual([]);
        });

        it('should extract sources from a: tool result lines', () => {
            const stream = [
                '9:{"toolCallId":"c1","toolName":"search","args":{"query":"test"}}',
                'a:{"toolCallId":"c1","result":{"results":[{"path":"/getting-started/quickstart","metadata":{"title":"Quick Start"}}]}}',
                '0:"Answer text"',
            ].join('\n');

            const result = parseVercelAIStream(stream, 'https://docs.elementum.io');
            expect(result.answer).toBe('Answer text');
            expect(result.sources).toHaveLength(1);
            expect(result.sources[0].url).toBe('https://docs.elementum.io/getting-started/quickstart');
            expect(result.sources[0].title).toBe('Quick Start');
        });

        it('should handle absolute URLs in sources', () => {
            const stream = [
                'a:{"toolCallId":"c1","result":{"results":[{"path":"https://other.site.com/page","metadata":{"title":"External"}}]}}',
                '0:"Text"',
            ].join('\n');

            const result = parseVercelAIStream(stream, 'https://docs.elementum.io');
            expect(result.sources[0].url).toBe('https://other.site.com/page');
        });

        it('should handle empty/malformed lines gracefully', () => {
            const stream = [
                '',
                'invalid-line',
                '0:"Valid chunk"',
                'x:not-json',
            ].join('\n');

            const result = parseVercelAIStream(stream, 'https://docs.elementum.io');
            expect(result.answer).toBe('Valid chunk');
            expect(result.sources).toEqual([]);
        });
    });
});
