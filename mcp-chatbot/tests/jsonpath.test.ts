import { describe, it, expect } from 'vitest';
import { extractByPath } from '../src/utils/jsonpath.js';

describe('extractByPath', () => {
    it('should extract a top-level field', () => {
        expect(extractByPath({ answer: 'hello' }, '$.answer')).toBe('hello');
    });

    it('should extract a nested field', () => {
        expect(extractByPath({ data: { result: 'ok' } }, '$.data.result')).toBe('ok');
    });

    it('should extract by array index', () => {
        const obj = { choices: [{ message: { content: 'foo' } }] };
        expect(extractByPath(obj, '$.choices[0].message.content')).toBe('foo');
    });

    it('should extract with wildcard [*]', () => {
        const obj = { sources: [{ url: 'a.com' }, { url: 'b.com' }] };
        expect(extractByPath(obj, '$.sources[*].url')).toEqual(['a.com', 'b.com']);
    });

    it('should return undefined for missing paths', () => {
        expect(extractByPath({ a: 1 }, '$.b')).toBeUndefined();
    });

    it('should return undefined for null input', () => {
        expect(extractByPath(null, '$.a')).toBeUndefined();
    });

    it('should handle paths without $. prefix', () => {
        expect(extractByPath({ answer: 'test' }, 'answer')).toBe('test');
    });

    it('should return entire array with wildcard and no remaining path', () => {
        const obj = { items: ['a', 'b', 'c'] };
        expect(extractByPath(obj, '$.items[*]')).toEqual(['a', 'b', 'c']);
    });
});
