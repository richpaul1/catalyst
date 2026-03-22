import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sourceContentExtraction } from '../src/tools/content-extract.js';

// Mock the http-client module
vi.mock('../src/utils/http-client.js', () => ({
    fetchPage: vi.fn(),
}));

import { fetchPage } from '../src/utils/http-client.js';
const mockFetchPage = vi.mocked(fetchPage);

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Test Page</title></head>
<body>
  <nav><a href="/">Home</a><a href="/docs">Docs</a></nav>
  <header><h1>Site Header</h1></header>
  <article>
    <h1>Webhook Configuration</h1>
    <p>Follow these steps to configure webhooks.</p>
    <img src="/images/webhook-setup.png" alt="Setup diagram" />
    <p>Watch the demo video:</p>
    <video src="/videos/webhook-demo.mp4" title="Webhook Demo"></video>
    <p>Or see on YouTube:</p>
    <iframe src="https://www.youtube.com/embed/abc123" title="YouTube Tutorial"></iframe>
    <h2>Step 1</h2>
    <p>Navigate to Settings.</p>
    <img src="https://cdn.example.com/settings-icon.png" alt="Settings" />
  </article>
  <footer><p>Copyright 2026</p></footer>
</body>
</html>
`;

describe('sourceContentExtraction', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should fetch and convert HTML to markdown with media preserved', async () => {
        mockFetchPage.mockResolvedValue({
            html: SAMPLE_HTML,
            status: 200,
        });

        const result = await sourceContentExtraction({
            urls: ['https://docs.example.com/webhooks/config'],
            preserve_media: true,
            media_base_url: 'https://docs.example.com',
        });

        expect(result.sources).toHaveLength(1);
        const source = result.sources[0];
        expect(source.status).toBe('success');
        expect(source.title).toBe('Test Page');
        expect(source.content_length).toBeGreaterThan(0);

        // Check markdown contains image references
        expect(source.markdown).toContain('![Setup diagram](https://docs.example.com/images/webhook-setup.png)');
        expect(source.markdown).toContain('![Settings](https://cdn.example.com/settings-icon.png)');

        // Check markdown contains video references
        expect(source.markdown).toContain('[Video: Webhook Demo](https://docs.example.com/videos/webhook-demo.mp4)');
        expect(source.markdown).toContain('[Video: YouTube Tutorial](https://www.youtube.com/embed/abc123)');

        // Check navigation was stripped
        expect(source.markdown).not.toContain('Home');
        expect(source.markdown).not.toContain('Copyright 2026');

        // Check media catalog
        expect(source.media.length).toBeGreaterThanOrEqual(2);
        const images = source.media.filter((m) => m.type === 'image');
        const videos = source.media.filter((m) => m.type === 'video');
        expect(images.length).toBeGreaterThanOrEqual(2);
        expect(videos.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle content_selector to isolate content', async () => {
        mockFetchPage.mockResolvedValue({
            html: SAMPLE_HTML,
            status: 200,
        });

        const result = await sourceContentExtraction({
            urls: ['https://docs.example.com/webhooks/config'],
            content_selector: 'article',
            media_base_url: 'https://docs.example.com',
        });

        const source = result.sources[0];
        expect(source.status).toBe('success');
        expect(source.markdown).toContain('Webhook Configuration');
        expect(source.markdown).toContain('Follow these steps');
    });

    it('should handle multiple URLs in parallel', async () => {
        mockFetchPage
            .mockResolvedValueOnce({
                html: '<html><head><title>Page 1</title></head><body><p>Content 1</p></body></html>',
                status: 200,
            })
            .mockResolvedValueOnce({
                html: '<html><head><title>Page 2</title></head><body><p>Content 2</p></body></html>',
                status: 200,
            });

        const result = await sourceContentExtraction({
            urls: [
                'https://docs.example.com/page1',
                'https://docs.example.com/page2',
            ],
        });

        expect(result.sources).toHaveLength(2);
        expect(result.sources[0].title).toBe('Page 1');
        expect(result.sources[1].title).toBe('Page 2');
    });

    it('should handle fetch failures gracefully', async () => {
        mockFetchPage.mockResolvedValue({
            html: '',
            status: 403,
            error: 'HTTP 403',
        });

        const result = await sourceContentExtraction({
            urls: ['https://private.example.com/page'],
        });

        expect(result.sources).toHaveLength(1);
        expect(result.sources[0].status).toContain('failed');
        expect(result.sources[0].markdown).toBe('');
    });

    it('should return error when no URLs provided', async () => {
        const result = await sourceContentExtraction({ urls: [] });

        expect(result.sources).toEqual([]);
        expect(result.error).toBe('No URLs provided');
    });

    it('should report total media count across all sources', async () => {
        mockFetchPage
            .mockResolvedValueOnce({
                html: '<html><head><title>P1</title></head><body><img src="/a.png" alt="A"/><img src="/b.png" alt="B"/></body></html>',
                status: 200,
            })
            .mockResolvedValueOnce({
                html: '<html><head><title>P2</title></head><body><img src="/c.png" alt="C"/></body></html>',
                status: 200,
            });

        const result = await sourceContentExtraction({
            urls: ['https://example.com/1', 'https://example.com/2'],
            media_base_url: 'https://example.com',
        });

        expect(result.total_media_count).toBe(3);
    });

    it('should resolve relative URLs using media_base_url', async () => {
        mockFetchPage.mockResolvedValue({
            html: '<html><head><title>T</title></head><body><img src="/assets/photo.jpg" alt="Photo"/></body></html>',
            status: 200,
        });

        const result = await sourceContentExtraction({
            urls: ['https://docs.example.com/page'],
            media_base_url: 'https://docs.example.com',
        });

        expect(result.sources[0].markdown).toContain('![Photo](https://docs.example.com/assets/photo.jpg)');
        expect(result.sources[0].media[0].url).toBe('https://docs.example.com/assets/photo.jpg');
    });
});
