/**
 * JSONPath Extraction Utility
 *
 * Simple JSONPath-like extraction for common patterns used in chatbot API responses.
 * Supports: $.field, $.field.nested, $.array[*].field, $.array[0].field
 */

/**
 * Extract a value from a JSON object using a simplified JSONPath expression.
 *
 * Supported patterns:
 *   $.answer              → obj.answer
 *   $.data.answer         → obj.data.answer
 *   $.choices[0].message  → obj.choices[0].message
 *   $.sources[*].url      → obj.sources.map(s => s.url)
 */
export function extractByPath(obj: unknown, path: string): unknown {
    if (!obj || !path) return undefined;

    // Remove leading $. if present
    const cleaned = path.startsWith('$.') ? path.slice(2) : path;

    const segments = parsePathSegments(cleaned);
    return resolveSegments(obj, segments);
}

interface PathSegment {
    key: string;
    index?: number | '*';
}

/**
 * Parse a dot-separated path into segments, handling array notation.
 * e.g., "choices[0].message.content" → [
 *   { key: "choices", index: 0 },
 *   { key: "message" },
 *   { key: "content" }
 * ]
 */
function parsePathSegments(path: string): PathSegment[] {
    const segments: PathSegment[] = [];
    const parts = path.split('.');

    for (const part of parts) {
        const bracketMatch = part.match(/^([^[]+)\[(\*|\d+)\]$/);
        if (bracketMatch) {
            const key = bracketMatch[1];
            const indexStr = bracketMatch[2];
            segments.push({
                key,
                index: indexStr === '*' ? '*' : parseInt(indexStr, 10),
            });
        } else {
            segments.push({ key: part });
        }
    }

    return segments;
}

/**
 * Resolve path segments against an object
 */
function resolveSegments(obj: unknown, segments: PathSegment[]): unknown {
    let current: unknown = obj;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];

        if (current === null || current === undefined) return undefined;
        if (typeof current !== 'object') return undefined;

        // Access the key
        current = (current as Record<string, unknown>)[segment.key];

        // Handle array index
        if (segment.index !== undefined) {
            if (!Array.isArray(current)) return undefined;

            if (segment.index === '*') {
                // Wildcard: map remaining segments over each array element
                const remainingSegments = segments.slice(i + 1);
                if (remainingSegments.length === 0) {
                    return current;
                }
                return current.map((item) => resolveSegments(item, remainingSegments));
            } else {
                current = current[segment.index];
            }
        }
    }

    return current;
}
