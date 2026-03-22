/**
 * HTML to Markdown Converter
 *
 * Converts HTML content to markdown while preserving image/video references
 * and resolving relative URLs to absolute paths.
 */

import TurndownService from 'turndown';
import { JSDOM } from 'jsdom';

export interface MediaReference {
    type: 'image' | 'video';
    url: string;
    alt: string;
}

export interface ConversionResult {
    markdown: string;
    media: MediaReference[];
}

export interface ConversionOptions {
    /** CSS selector to isolate main content area (e.g., 'article', '.content-area') */
    contentSelector?: string;
    /** Strip nav, header, footer, sidebar elements */
    stripNavigation?: boolean;
    /** Preserve image and video references in the output */
    preserveMedia?: boolean;
    /** Base URL to resolve relative paths */
    mediaBaseUrl?: string;
    /** Max characters for the markdown output */
    maxContentLength?: number;
}

/**
 * Resolve a potentially relative URL to an absolute URL
 */
export function resolveUrl(url: string, baseUrl: string): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
        return url.startsWith('//') ? `https:${url}` : url;
    }
    try {
        return new URL(url, baseUrl).href;
    } catch {
        return url;
    }
}

/**
 * Extract all media references from an HTML document
 */
function extractMedia(doc: Document, baseUrl: string): MediaReference[] {
    const media: MediaReference[] = [];

    // Images
    doc.querySelectorAll('img').forEach((img) => {
        const src = img.getAttribute('src');
        if (src) {
            media.push({
                type: 'image',
                url: resolveUrl(src, baseUrl),
                alt: img.getAttribute('alt') || '',
            });
        }
    });

    // Video elements
    doc.querySelectorAll('video').forEach((video) => {
        const src = video.getAttribute('src') || video.querySelector('source')?.getAttribute('src');
        if (src) {
            media.push({
                type: 'video',
                url: resolveUrl(src, baseUrl),
                alt: video.getAttribute('title') || '',
            });
        }
    });

    // Iframes (YouTube, Vimeo, etc.)
    doc.querySelectorAll('iframe').forEach((iframe) => {
        const src = iframe.getAttribute('src');
        if (src && (src.includes('youtube') || src.includes('vimeo') || src.includes('player'))) {
            media.push({
                type: 'video',
                url: resolveUrl(src, baseUrl),
                alt: iframe.getAttribute('title') || '',
            });
        }
    });

    return media;
}

/**
 * Strip non-content elements (scripts, styles, etc.) from the document.
 * These should never appear in markdown output regardless of settings.
 */
function stripNonContentElements(doc: Document): void {
    const selectors = [
        'script', 'style', 'noscript', 'link', 'template',
        'svg[aria-hidden="true"]', 'svg:not([aria-hidden])',
        '[hidden]', '[style*="display:none"]', '[style*="display: none"]',
    ];

    selectors.forEach((selector) => {
        try {
            doc.querySelectorAll(selector).forEach((el) => el.remove());
        } catch {
            // Some selectors may not be supported in JSDOM, skip
        }
    });
}

/**
 * Strip navigation elements from the document
 */
function stripNavigationElements(doc: Document): void {
    const selectors = [
        'nav', 'header', 'footer',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '.sidebar', '.nav', '.navbar', '.menu', '.breadcrumb',
        '.table-of-contents', '.toc',
        // Mintlify-specific selectors
        '[class*="sidebar"]', '[class*="Sidebar"]',
        '[class*="navigation"]', '[class*="Navigation"]',
        '[class*="breadcrumb"]', '[class*="Breadcrumb"]',
        '[class*="on-this-page"]', '[class*="toc"]',
        '[id*="sidebar"]', '[id*="navigation"]',
        'a[href="#content-area"]', // "Skip to main content" links
    ];

    selectors.forEach((selector) => {
        try {
            doc.querySelectorAll(selector).forEach((el) => el.remove());
        } catch {
            // Some selectors may not be supported, skip
        }
    });
}

/**
 * Create a configured Turndown service with media preservation
 */
function createTurndownService(baseUrl: string, preserveMedia: boolean): TurndownService {
    const turndown = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    });

    if (preserveMedia) {
        // Resolve relative image URLs
        turndown.addRule('images', {
            filter: 'img',
            replacement: (_content, node) => {
                const el = node as HTMLImageElement;
                const src = resolveUrl(el.getAttribute('src') || '', baseUrl);
                const alt = el.getAttribute('alt') || '';
                if (!src) return '';
                return `![${alt}](${src})`;
            },
        });

        // Convert video elements to markdown
        turndown.addRule('video', {
            filter: 'video',
            replacement: (_content, node) => {
                const el = node as HTMLVideoElement;
                const src = el.getAttribute('src') || el.querySelector('source')?.getAttribute('src') || '';
                const resolved = resolveUrl(src, baseUrl);
                const title = el.getAttribute('title') || 'Video';
                return `[Video: ${title}](${resolved})`;
            },
        });

        // Convert iframes (YouTube, Vimeo) to markdown links
        turndown.addRule('iframe-video', {
            filter: (node) => {
                if (node.nodeName !== 'IFRAME') return false;
                const src = node.getAttribute('src') || '';
                return src.includes('youtube') || src.includes('vimeo') || src.includes('player');
            },
            replacement: (_content, node) => {
                const el = node as HTMLIFrameElement;
                const src = resolveUrl(el.getAttribute('src') || '', baseUrl);
                const title = el.getAttribute('title') || 'Video';
                return `[Video: ${title}](${src})`;
            },
        });
    }

    return turndown;
}

/**
 * Strip Mintlify-specific artifacts that produce messy markdown.
 * Mintlify wraps heading text with anchor tags containing zero-width spaces:
 *   <h2><a href="#slug">​</a>Title</h2>
 * These produce ugly [​](#slug) fragments in markdown output.
 */
function stripMintlifyArtifacts(doc: Document): void {
    // Remove anchor tags inside headings that contain only whitespace/zero-width chars
    doc.querySelectorAll('h1 a, h2 a, h3 a, h4 a, h5 a, h6 a').forEach((a) => {
        const text = a.textContent || '';
        // If the anchor only contains zero-width spaces, regular whitespace, or is empty — remove it
        if (/^[\s\u200B\u200C\u200D\uFEFF]*$/.test(text)) {
            a.remove();
        }
    });

    // Remove "Copy" and "Ask AI" button elements that Mintlify injects into code blocks
    doc.querySelectorAll('button').forEach((btn) => {
        const text = (btn.textContent || '').trim();
        if (text === 'Copy' || text === 'Ask AI') {
            btn.remove();
        }
    });
}

/**
 * Post-process markdown to clean up conversion artifacts
 */
function cleanMarkdown(md: string): string {
    return md
        // Remove zero-width space characters
        .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
        // Remove leftover empty anchor links: [](#...) or [ ](#...)
        .replace(/\[[\s]*\]\(#[^)]*\)/g, '')
        // Remove "Copy\n\nAsk AI" artifacts from code blocks
        .replace(/\n*Copy\n+Ask AI\n*/g, '\n')
        // Fix broken headings: "## \n\nTitle" → "## Title"
        .replace(/^(#{1,6})\s*\n+\s*/gm, '$1 ')
        // Collapse 3+ consecutive newlines to 2
        .replace(/\n{3,}/g, '\n\n')
        // Trim leading/trailing whitespace
        .trim();
}

/**
 * Convert HTML to markdown with media preservation
 */
export function htmlToMarkdown(html: string, options: ConversionOptions = {}): ConversionResult {
    const {
        contentSelector,
        stripNavigation = true,
        preserveMedia = true,
        mediaBaseUrl = '',
        maxContentLength = 50000,
    } = options;

    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Extract media before any stripping
    const media = preserveMedia ? extractMedia(doc, mediaBaseUrl) : [];

    // Always strip non-content elements (scripts, styles, etc.)
    stripNonContentElements(doc);

    // Strip Mintlify-specific artifacts (heading anchors, button text)
    stripMintlifyArtifacts(doc);

    // Strip navigation elements
    if (stripNavigation) {
        stripNavigationElements(doc);
    }

    // Isolate content by selector
    let contentRoot: Element | null = null;
    if (contentSelector) {
        contentRoot = doc.querySelector(contentSelector);
    }

    const targetHtml = contentRoot ? contentRoot.innerHTML : doc.body.innerHTML;

    // Convert to markdown
    const turndown = createTurndownService(mediaBaseUrl, preserveMedia);
    let markdown = turndown.turndown(targetHtml);

    // Post-process: clean up zero-width characters, empty anchors, excessive newlines
    markdown = cleanMarkdown(markdown);

    // Truncate if needed
    if (markdown.length > maxContentLength) {
        markdown = markdown.substring(0, maxContentLength) + '\n\n...(truncated)';
    }

    return { markdown, media };
}

/**
 * Extract page title from HTML
 */
export function extractTitle(html: string): string {
    const dom = new JSDOM(html);
    const doc = dom.window.document;

    // Try <title> tag
    const title = doc.querySelector('title')?.textContent?.trim();
    if (title) return title;

    // Try first <h1>
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    if (h1) return h1;

    // Try og:title
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
    if (ogTitle) return ogTitle;

    return 'Untitled';
}
