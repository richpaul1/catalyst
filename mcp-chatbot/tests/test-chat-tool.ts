#!/usr/bin/env npx tsx

/**
 * Manual Test Script for MCP Chatbot Tools
 *
 * Tests tools against the live Mintlify-powered chat on docs.elementum.io:
 *   1. chatbot  — external_chatbot_query → Mintlify assistant API (Vercel AI stream)
 *   2. extract  — source_content_extraction → fetch docs pages → markdown
 *   3. combined — query chatbot → extract source URLs → fetch full markdown from sources
 *
 * Usage:
 *   npx tsx tests/test-chat-tool.ts                # run all tests
 *   npx tsx tests/test-chat-tool.ts chatbot        # chatbot query only
 *   npx tsx tests/test-chat-tool.ts extract        # content extraction only
 *   npx tsx tests/test-chat-tool.ts combined       # full pipeline: chatbot → sources → markdown
 */

import { externalChatbotQuery } from '../src/tools/chatbot-query.js';
import { sourceContentExtraction } from '../src/tools/content-extract.js';

// ─── Helpers ──────────────────────────────────────────────

const DIVIDER = '═'.repeat(70);
const SUB_DIVIDER = '─'.repeat(70);

function header(title: string) {
    console.log(`\n${DIVIDER}`);
    console.log(`  ${title}`);
    console.log(DIVIDER);
}

function section(title: string) {
    console.log(`\n${SUB_DIVIDER}`);
    console.log(`  ${title}`);
    console.log(SUB_DIVIDER);
}

function truncate(text: string, maxLen = 500): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + `\n... [truncated, ${text.length} chars total]`;
}

/**
 * Parse Vercel AI Data Stream response.
 *
 * Format is line-based with a single-char prefix + colon:
 *   f: — message metadata (JSON)
 *   0: — text content chunk (JSON string)
 *   9: — tool call initiation (JSON)
 *   a: — tool call result (JSON)
 *   e: — finish reason / token usage (JSON)
 *   d: — done signal
 */
function parseVercelAIStream(text: string): {
    answer: string;
    sources: Array<{ title: string; url: string }>;
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
} {
    const lines = text.split('\n').filter((l) => l.trim());
    let answer = '';
    const sources: Array<{ title: string; url: string }> = [];
    const toolCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];

    for (const line of lines) {
        const colonIdx = line.indexOf(':');
        if (colonIdx < 1) continue;

        const prefix = line.slice(0, colonIdx);
        const payload = line.slice(colonIdx + 1);

        try {
            switch (prefix) {
                case '0': {
                    // Text content chunk — JSON-encoded string
                    const chunk = JSON.parse(payload);
                    if (typeof chunk === 'string') {
                        answer += chunk;
                    }
                    break;
                }
                case '9': {
                    // Tool call
                    const toolCall = JSON.parse(payload);
                    if (toolCall.toolName) {
                        toolCalls.push({
                            toolName: toolCall.toolName,
                            args: toolCall.args || {},
                        });
                    }
                    break;
                }
                case 'a': {
                    // Tool result — extract search results as sources
                    const toolResult = JSON.parse(payload);
                    const results = toolResult?.result?.results;
                    if (Array.isArray(results)) {
                        for (const r of results) {
                            if (r.path) {
                                sources.push({
                                    title: r.metadata?.title || r.path,
                                    url: `https://docs.elementum.io/${r.path}`,
                                });
                            }
                        }
                    }
                    break;
                }
                // f:, e:, d: — metadata/finish, skip
            }
        } catch {
            // Non-JSON payload, skip
        }
    }

    return { answer, sources, toolCalls };
}

// ─── Mintlify API Helper ──────────────────────────────────

/**
 * Query the Mintlify chatbot and parse the Vercel AI stream response.
 * Returns the parsed answer, sources, and tool calls.
 */
async function queryMintlify(query: string): Promise<{
    status: number;
    answer: string;
    sources: Array<{ title: string; url: string }>;
    toolCalls: Array<{ toolName: string; args: Record<string, unknown> }>;
    responseTimeMs: number;
}> {
    const start = Date.now();
    const response = await fetch(
        'https://leaves.mintlify.com/api/assistant/elementum/message',
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Origin: 'https://docs.elementum.io',
                Referer: 'https://docs.elementum.io/',
            },
            body: JSON.stringify({
                id: 'elementum',
                messages: [
                    {
                        id: `test-${Date.now().toString(36)}`,
                        createdAt: new Date().toISOString(),
                        role: 'user',
                        content: query,
                        parts: [{ type: 'text', text: query }],
                    },
                ],
                fp: 'elementum',
                currentPath: '/',
            }),
            signal: AbortSignal.timeout(60000),
        }
    );
    const responseTimeMs = Date.now() - start;
    const rawText = await response.text();
    const parsed = parseVercelAIStream(rawText);

    return {
        status: response.status,
        responseTimeMs,
        ...parsed,
    };
}

// ─── Test 1: External Chatbot Query ───────────────────────

async function testChatbotQuery() {
    header('TEST 1: external_chatbot_query (Mintlify / Vercel AI Stream)');
    const query = 'What are Elementum workflows?';
    console.log('Target: Mintlify AI Assistant on docs.elementum.io');
    console.log(`Query:  "${query}"`);

    const result = await queryMintlify(query);

    section('Result');
    console.log(`  Status: ${result.status}`);
    console.log(`  Time:   ${result.responseTimeMs}ms`);

    console.log(`\n  Tool calls: ${result.toolCalls.length}`);
    for (const tc of result.toolCalls) {
        console.log(`    → ${tc.toolName}(${JSON.stringify(tc.args)})`);
    }

    console.log(`\n  Sources: ${result.sources.length}`);
    for (const src of result.sources) {
        console.log(`    • ${src.title}`);
        console.log(`      ${src.url}`);
    }

    section('Answer');
    console.log(truncate(result.answer, 800));

    return result;
}

// ─── Test 2: Source Content Extraction ────────────────────

async function testContentExtraction() {
    header('TEST 2: source_content_extraction');

    const urls = [
        'https://docs.elementum.io/getting-started/welcome-to-elementum',
        'https://docs.elementum.io/getting-started/quickstart',
    ];

    console.log('URLs:');
    urls.forEach((u) => console.log(`   • ${u}`));

    const result = await sourceContentExtraction({
        urls,
        content_selector: 'article',
        strip_navigation: true,
        preserve_media: true,
        media_base_url: 'https://docs.elementum.io',
        max_content_length: 50000,
        timeout_ms: 30000,
    });

    section(`Results (${result.sources.length} pages, ${result.total_media_count} media)`);

    for (const source of result.sources) {
        console.log(`\n  📄 ${source.title || '(no title)'}`);
        console.log(`     URL:    ${source.url}`);
        console.log(`     Status: ${source.status}`);
        console.log(`     Length: ${source.content_length} chars`);
        console.log(`     Media:  ${source.media.length} items`);

        if (source.media.length > 0) {
            section('Media Catalog');
            for (const m of source.media.slice(0, 5)) {
                console.log(`     [${m.type}] ${m.alt || '(no alt)'}`);
                console.log(`       ${m.url}`);
            }
            if (source.media.length > 5) {
                console.log(`     ... and ${source.media.length - 5} more`);
            }
        }

        section('Markdown Preview');
        console.log(truncate(source.markdown, 600));
    }

    if (result.error) {
        console.log(`\n❌ Error: ${result.error}`);
    }

    return result;
}

// ─── Test 3: Combined Pipeline ───────────────────────────

async function testCombined() {
    header('TEST 3: Combined Pipeline — Query → Sources → Markdown');
    const query = process.argv[3] || 'How do AI agents work in Elementum?';
    console.log(`Query: "${query}"`);

    // Step 1: Query the chatbot
    section('Step 1 — Querying Mintlify chatbot');
    const chatResult = await queryMintlify(query);

    console.log(`  ✅ Status: ${chatResult.status} (${chatResult.responseTimeMs}ms)`);
    console.log(`  Tool calls: ${chatResult.toolCalls.length}`);
    for (const tc of chatResult.toolCalls) {
        console.log(`    → ${tc.toolName}(${JSON.stringify(tc.args)})`);
    }

    section('Chatbot Answer');
    console.log(truncate(chatResult.answer, 600));

    // Step 2: Deduplicate and collect source URLs
    const sourceUrls = [...new Set(chatResult.sources.map((s) => s.url))];

    section(`Step 2 — Found ${sourceUrls.length} unique source URLs`);
    if (sourceUrls.length === 0) {
        console.log('  ⚠️  No source URLs found in chatbot response. Skipping extraction.');
        return;
    }
    for (const url of sourceUrls) {
        console.log(`    • ${url}`);
    }

    // Step 3: Fetch full markdown from each source
    section('Step 3 — Extracting full markdown from sources');
    const extractResult = await sourceContentExtraction({
        urls: sourceUrls,
        content_selector: 'article',
        strip_navigation: true,
        preserve_media: true,
        media_base_url: 'https://docs.elementum.io',
        max_content_length: 50000,
        timeout_ms: 30000,
    });

    const succeeded = extractResult.sources.filter((s) => s.status === 'success');
    const failed = extractResult.sources.filter((s) => s.status !== 'success');

    console.log(`  ✅ Extracted: ${succeeded.length} pages`);
    console.log(`  ❌ Failed:    ${failed.length} pages`);
    console.log(`  📎 Media:     ${extractResult.total_media_count} total items`);

    // Step 4: Summary of each extracted source
    section('Step 4 — Extracted Source Summaries');
    for (const source of extractResult.sources) {
        const statusIcon = source.status === 'success' ? '✅' : '❌';
        console.log(`\n  ${statusIcon} ${source.title || '(no title)'}`);
        console.log(`     URL:    ${source.url}`);
        console.log(`     Status: ${source.status}`);
        console.log(`     Length: ${source.content_length} chars`);
        console.log(`     Media:  ${source.media.length} items`);

        if (source.status === 'success') {
            // Show first 300 chars of markdown as preview
            console.log(`     Preview: ${truncate(source.markdown, 200)}`);
        }
    }

    // Final summary
    section('Pipeline Summary');
    console.log(`  Query:           "${query}"`);
    console.log(`  Answer length:   ${chatResult.answer.length} chars`);
    console.log(`  Sources found:   ${sourceUrls.length}`);
    console.log(`  Pages extracted: ${succeeded.length}/${sourceUrls.length}`);
    console.log(`  Total content:   ${succeeded.reduce((sum, s) => sum + s.content_length, 0)} chars`);
    console.log(`  Total media:     ${extractResult.total_media_count} items`);
}

// ─── Runner ──────────────────────────────────────────────

async function main() {
    const arg = process.argv[2]?.toLowerCase();

    console.log('╔══════════════════════════════════════════════════════════════════════╗');
    console.log('║           MCP Chatbot Tools — Live Integration Test                 ║');
    console.log('╚══════════════════════════════════════════════════════════════════════╝');

    try {
        if (!arg || arg === 'chatbot') {
            await testChatbotQuery();
        }

        if (!arg || arg === 'extract') {
            await testContentExtraction();
        }

        if (!arg || arg === 'combined') {
            await testCombined();
        }

        header('DONE');
        console.log('All tests completed.\n');
    } catch (err) {
        console.error('\n💥 Unhandled error:', err);
        process.exit(1);
    }
}

main();
