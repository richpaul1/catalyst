/**
 * Headless Browser Utility
 *
 * Uses Puppeteer to fetch fully rendered HTML from JavaScript-heavy pages
 * (e.g., Next.js/React apps like Mintlify docs). Manages a shared browser
 * instance that is lazily created and reused across requests.
 *
 * Content isolation happens HERE in the real browser DOM, not in JSDOM,
 * ensuring selectors like '#content' work reliably against the rendered page.
 */

import puppeteer, { type Browser } from 'puppeteer';
import { createLogger } from './logger.js';

const log = createLogger('headless-browser');

let browserInstance: Browser | null = null;

/**
 * Get or create the shared browser instance
 */
async function getBrowser(): Promise<Browser> {
    if (browserInstance && browserInstance.connected) {
        return browserInstance;
    }

    log.info('Launching headless browser');
    browserInstance = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });

    return browserInstance;
}

/**
 * Fetch a fully rendered HTML page using a headless browser.
 * If contentSelector is provided, extracts only that element's HTML
 * from the live DOM — much more reliable than post-hoc JSDOM parsing.
 */
export async function fetchRenderedPage(
    url: string,
    timeoutMs: number = 30000,
    contentSelector?: string
): Promise<{ html: string; status: number; error?: string }> {
    let page;
    try {
        const browser = await getBrowser();
        page = await browser.newPage();

        // Block unnecessary resources to speed up loading
        await page.setRequestInterception(true);
        page.on('request', (req) => {
            const resourceType = req.resourceType();
            if (['font', 'media'].includes(resourceType)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        const response = await page.goto(url, {
            waitUntil: 'networkidle2',
            timeout: timeoutMs,
        });

        const status = response?.status() ?? 0;

        if (status >= 400) {
            return { html: '', status, error: `HTTP ${status}` };
        }

        // Wait for body to be ready
        await page.waitForSelector('body', { timeout: 5000 }).catch(() => {});

        let html: string;

        if (contentSelector) {
            // Wait for the content selector to appear
            await page.waitForSelector(contentSelector, { timeout: 5000 }).catch(() => {});

            // Extract only the targeted element's outer HTML from the live DOM
            const extracted = await page.evaluate((selector) => {
                const el = document.querySelector(selector);
                if (!el) return null;
                return {
                    html: el.outerHTML,
                    title: document.title || '',
                };
            }, contentSelector);

            if (extracted) {
                // Wrap in minimal HTML with the page title so extractTitle() still works
                html = `<!DOCTYPE html><html><head><title>${extracted.title}</title></head><body>${extracted.html}</body></html>`;
                log.debug('Content isolated', { url, selector: contentSelector, htmlLength: html.length });
            } else {
                // Selector not found — fall back to full page
                html = await page.content();
                log.warn('Content selector not found, using full page', { url, selector: contentSelector, htmlLength: html.length });
            }
        } else {
            html = await page.content();
        }

        log.debug('Page rendered', { url, status, htmlLength: html.length });
        return { html, status };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        log.warn('Page render failed', { url, error: message });
        return { html: '', status: 0, error: message };
    } finally {
        if (page) {
            await page.close().catch(() => {});
        }
    }
}

/**
 * Close the shared browser instance (for cleanup)
 */
export async function closeBrowser(): Promise<void> {
    if (browserInstance) {
        await browserInstance.close().catch(() => {});
        browserInstance = null;
        log.info('Headless browser closed');
    }
}
