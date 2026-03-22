/**
 * HTTP Client Utility
 *
 * Handles HTTP requests with configurable auth, timeout, and retry logic
 * for external chatbot APIs and web page fetching.
 */

export type AuthType = 'none' | 'api_key' | 'bearer' | 'cookie';

export interface HttpRequestOptions {
    url: string;
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    authType?: AuthType;
    authToken?: string;
    timeoutMs?: number;
    retryOn5xx?: boolean;
}

export interface HttpResponse {
    status: number;
    body: unknown;
    text: string;
    responseTimeMs: number;
}

/**
 * Apply auth headers based on auth type
 */
function applyAuth(
    headers: Record<string, string>,
    authType: AuthType,
    authToken?: string
): Record<string, string> {
    if (!authToken || authType === 'none') return headers;

    switch (authType) {
        case 'api_key':
            return { ...headers, 'X-API-Key': authToken };
        case 'bearer':
            return { ...headers, Authorization: `Bearer ${authToken}` };
        case 'cookie':
            return { ...headers, Cookie: authToken };
        default:
            return headers;
    }
}

/**
 * Execute an HTTP request with timeout and optional retry
 */
export async function httpRequest(options: HttpRequestOptions): Promise<HttpResponse> {
    const {
        url,
        method = 'GET',
        body,
        headers = {},
        authType = 'none',
        authToken,
        timeoutMs = 30000,
        retryOn5xx = true,
    } = options;

    const finalHeaders = applyAuth(
        { 'Content-Type': 'application/json', ...headers },
        authType,
        authToken
    );

    const fetchOptions: RequestInit = {
        method,
        headers: finalHeaders,
        signal: AbortSignal.timeout(timeoutMs),
    };

    if (body && method === 'POST') {
        fetchOptions.body = JSON.stringify(body);
    }

    const execute = async (): Promise<HttpResponse> => {
        const start = Date.now();
        const response = await fetch(url, fetchOptions);
        const responseTimeMs = Date.now() - start;
        const text = await response.text();

        let parsedBody: unknown;
        try {
            parsedBody = JSON.parse(text);
        } catch {
            parsedBody = text;
        }

        return {
            status: response.status,
            body: parsedBody,
            text,
            responseTimeMs,
        };
    };

    try {
        const result = await execute();

        // Retry once on 5xx
        if (retryOn5xx && result.status >= 500) {
            try {
                return await execute();
            } catch {
                return result; // Return original 5xx if retry also fails
            }
        }

        return result;
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('TimeoutError') || message.includes('abort')) {
            return {
                status: 408,
                body: { error: `Request timed out after ${timeoutMs}ms` },
                text: '',
                responseTimeMs: timeoutMs,
            };
        }

        return {
            status: 0,
            body: { error: `Request failed: ${message}` },
            text: '',
            responseTimeMs: 0,
        };
    }
}

/**
 * Fetch an HTML page and return the raw text
 */
export async function fetchPage(
    url: string,
    timeoutMs: number = 30000
): Promise<{ html: string; status: number; error?: string }> {
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; MCPChatbot/1.0)',
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
            return { html: '', status: response.status, error: `HTTP ${response.status}` };
        }

        const html = await response.text();
        return { html, status: response.status };
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        return { html: '', status: 0, error: message };
    }
}
