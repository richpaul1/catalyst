/**
 * Crawl Tool (Source Content Extraction)
 *
 * Fetches HTML pages from given URLs using a headless browser (Puppeteer),
 * converts them to markdown while preserving image and video references.
 * Uses headless rendering to handle JavaScript-heavy pages (React, Next.js, etc.).
 */

import { fetchRenderedPage } from '../utils/headless-browser.js';
import { htmlToMarkdown, extractTitle, type MediaReference } from '../utils/html-to-markdown.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('crawl');

export interface ContentExtractionParams {
    /** URLs to fetch and convert */
    urls: string[];
    /** CSS selector to isolate main content */
    content_selector?: string;
    /** Strip navigation elements */
    strip_navigation?: boolean;
    /** Preserve image/video references */
    preserve_media?: boolean;
    /** Base URL for resolving relative paths */
    media_base_url?: string;
    /** Max characters per source page */
    max_content_length?: number;
    /** Request timeout per page in milliseconds */
    timeout_ms?: number;
}

export interface ExtractedSource {
    url: string;
    title: string;
    markdown: string;
    media: MediaReference[];
    content_length: number;
    status: 'success' | string;
}

export interface ContentExtractionResult {
    sources: ExtractedSource[];
    total_media_count: number;
    error?: string;
}

/** Maximum concurrent URL fetches */
const MAX_CONCURRENT = 3;

/**
 * Infer the base URL from a page URL (protocol + hostname)
 */
function inferBaseUrl(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.hostname}`;
    } catch {
        return '';
    }
}

/**
 * Fetch and convert a single URL to markdown using headless browser
 */
async function extractSingleSource(
    url: string,
    options: {
        contentSelector?: string;
        stripNavigation: boolean;
        preserveMedia: boolean;
        mediaBaseUrl: string;
        maxContentLength: number;
        timeoutMs: number;
    }
): Promise<ExtractedSource> {
    const { contentSelector, stripNavigation, preserveMedia, mediaBaseUrl, maxContentLength, timeoutMs } = options;

    // Fetch the page using headless browser — content isolation happens in-browser
    const pageResult = await fetchRenderedPage(url, timeoutMs, contentSelector);

    if (pageResult.error || !pageResult.html) {
        log.warn('Page fetch failed', { url, status: pageResult.status, error: pageResult.error });
        return {
            url,
            title: '',
            markdown: '',
            media: [],
            content_length: 0,
            status: `failed: ${pageResult.error || `HTTP ${pageResult.status}`}`,
        };
    }

    // Extract title before conversion
    const title = extractTitle(pageResult.html);

    // Determine base URL for resolving relative paths
    const baseUrl = mediaBaseUrl || inferBaseUrl(url);

    // Convert HTML to markdown — no contentSelector needed since Puppeteer already isolated the content
    const { markdown, media } = htmlToMarkdown(pageResult.html, {
        stripNavigation,
        preserveMedia,
        mediaBaseUrl: baseUrl,
        maxContentLength,
    });

    log.debug('Page extracted', { url, title, markdownLength: markdown.length, mediaCount: media.length });

    return {
        url,
        title,
        markdown,
        media,
        content_length: markdown.length,
        status: 'success',
    };
}

/**
 * Process URLs in batches with concurrency limit
 */
async function processInBatches<T>(
    items: T[],
    batchSize: number,
    processor: (item: T) => Promise<ExtractedSource>
): Promise<ExtractedSource[]> {
    const results: ExtractedSource[] = [];

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map(processor));
        results.push(...batchResults);
    }

    return results;
}

/**
 * Extract content from multiple URLs
 */
export async function crawl(
    params: ContentExtractionParams
): Promise<ContentExtractionResult> {
    const {
        urls,
        content_selector,
        strip_navigation = true,
        preserve_media = true,
        media_base_url = '',
        max_content_length = 50000,
        timeout_ms = 30000,
    } = params;

    if (!urls || urls.length === 0) {
        log.warn('No URLs provided');
        return {
            sources: [],
            total_media_count: 0,
            error: 'No URLs provided',
        };
    }

    // Cap at reasonable limit
    const limitedUrls = urls.slice(0, 10);

    const options = {
        contentSelector: content_selector,
        stripNavigation: strip_navigation,
        preserveMedia: preserve_media,
        mediaBaseUrl: media_base_url,
        maxContentLength: max_content_length,
        timeoutMs: timeout_ms,
    };

    // Process URLs with concurrency
    const sources = await processInBatches(
        limitedUrls,
        MAX_CONCURRENT,
        (url) => extractSingleSource(url, options)
    );

    const totalMediaCount = sources.reduce((sum, s) => sum + s.media.length, 0);
    const succeeded = sources.filter((s) => s.status === 'success').length;

    log.info('Extraction complete', {
        totalUrls: limitedUrls.length,
        succeeded,
        failed: limitedUrls.length - succeeded,
        totalMedia: totalMediaCount,
    });

    return {
        sources,
        total_media_count: totalMediaCount,
    };
}
