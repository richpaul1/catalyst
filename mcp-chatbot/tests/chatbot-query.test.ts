import { describe, it, expect, vi, beforeEach } from 'vitest';
import { externalChatbotQuery } from '../src/tools/chatbot-query.js';

// Mock the http-client module
vi.mock('../src/utils/http-client.js', () => ({
    httpRequest: vi.fn(),
}));

import { httpRequest } from '../src/utils/http-client.js';
const mockHttpRequest = vi.mocked(httpRequest);

describe('externalChatbotQuery', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should send a query and extract answer + sources', async () => {
        mockHttpRequest.mockResolvedValue({
            status: 200,
            body: {
                answer: 'To configure webhooks, go to Settings > Integrations.',
                sources: [
                    { title: 'Webhook Config', url: 'https://docs.example.com/webhooks' },
                    { title: 'Event Types', url: 'https://docs.example.com/events' },
                ],
            },
            text: '',
            responseTimeMs: 800,
        });

        const result = await externalChatbotQuery({
            chatbot_url: 'https://docs.example.com/api/chat',
            query: 'How do I configure webhooks?',
        });

        expect(result.answer).toBe('To configure webhooks, go to Settings > Integrations.');
        expect(result.sources).toHaveLength(2);
        expect(result.sources[0].url).toBe('https://docs.example.com/webhooks');
        expect(result.metadata.status_code).toBe(200);
        expect(result.error).toBeUndefined();
    });

    it('should use custom response_path and sources_path', async () => {
        mockHttpRequest.mockResolvedValue({
            status: 200,
            body: {
                choices: [{ message: { content: 'The answer is 42.' } }],
                references: [
                    { link: 'https://example.com/page1', name: 'Page 1' },
                ],
            },
            text: '',
            responseTimeMs: 500,
        });

        const result = await externalChatbotQuery({
            chatbot_url: 'https://api.example.com/chat',
            query: 'What is the answer?',
            response_path: '$.choices[0].message.content',
            sources_path: '$.references',
        });

        expect(result.answer).toBe('The answer is 42.');
        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].url).toBe('https://example.com/page1');
    });

    it('should render request template with {{query}} placeholder', async () => {
        mockHttpRequest.mockResolvedValue({
            status: 200,
            body: { answer: 'Template response' },
            text: '',
            responseTimeMs: 300,
        });

        await externalChatbotQuery({
            chatbot_url: 'https://api.example.com/chat',
            query: 'test question',
            request_template: {
                prompt: '{{query}}',
                model: 'gpt-4',
            },
        });

        expect(mockHttpRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                body: { prompt: 'test question', model: 'gpt-4' },
            })
        );
    });

    it('should pass auth type and token', async () => {
        mockHttpRequest.mockResolvedValue({
            status: 200,
            body: { answer: 'OK' },
            text: '',
            responseTimeMs: 200,
        });

        await externalChatbotQuery({
            chatbot_url: 'https://api.example.com/chat',
            query: 'test',
            auth_type: 'bearer',
            auth_token: 'my-token-123',
        });

        expect(mockHttpRequest).toHaveBeenCalledWith(
            expect.objectContaining({
                authType: 'bearer',
                authToken: 'my-token-123',
            })
        );
    });

    it('should handle HTTP errors gracefully', async () => {
        mockHttpRequest.mockResolvedValue({
            status: 500,
            body: { error: 'Internal server error' },
            text: '',
            responseTimeMs: 100,
        });

        const result = await externalChatbotQuery({
            chatbot_url: 'https://api.example.com/chat',
            query: 'test',
        });

        expect(result.error).toBeTruthy();
        expect(result.answer).toBe('');
        expect(result.sources).toEqual([]);
        expect(result.metadata.status_code).toBe(500);
    });

    it('should handle sources as array of URL strings', async () => {
        mockHttpRequest.mockResolvedValue({
            status: 200,
            body: {
                answer: 'Here is the info.',
                sources: [
                    'https://example.com/page1',
                    'https://example.com/page2',
                ],
            },
            text: '',
            responseTimeMs: 400,
        });

        const result = await externalChatbotQuery({
            chatbot_url: 'https://api.example.com/chat',
            query: 'test',
        });

        expect(result.sources).toHaveLength(2);
        expect(result.sources[0].url).toBe('https://example.com/page1');
        expect(result.sources[1].url).toBe('https://example.com/page2');
    });
});
