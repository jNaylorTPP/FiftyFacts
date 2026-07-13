#!/usr/bin/env node
/**
 * fifty-dog-facts.js
 *
 * Reference integration with the OpenAI API.
 *
 * Generates exactly 50 distinct dog facts and writes them to a text file,
 * one fact per line.
 *
 * Usage:
 *   export OPENAI_API_KEY="sk-..."      (PowerShell: $env:OPENAI_API_KEY="sk-...")
 *   node fifty-dog-facts.js [outputFile]
 *
 * Defaults to writing ./dog_facts.txt
 *
 * Requires Node 18+ (uses the built-in global fetch — zero dependencies).
 */

'use strict';

const fs = require('fs/promises');
const path = require('path');

// ---- Configuration ---------------------------------------------------------

const CONFIG = {
  apiKey: process.env.OPENAI_API_KEY,
  apiUrl: 'https://api.openai.com/v1/chat/completions',
  model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  targetCount: 50,
  outputFile: process.argv[2] || 'dog_facts.txt',
  requestTimeoutMs: 30_000,
  maxAttempts: 4, // total attempts to reach the target count
};

// ---- OpenAI call -----------------------------------------------------------

/**
 * Ask the model for `count` dog facts and return them as an array of strings.
 * Uses JSON mode so the response is reliably machine-parseable rather than
 * free-form prose that we would have to scrape.
 */
async function fetchDogFacts(count) {
  const body = {
    model: CONFIG.model,
    // Ask for a JSON object so the output is deterministic to parse.
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful assistant that returns strictly valid JSON. ' +
          'Return an object with a single key "facts" whose value is an array ' +
          'of concise, accurate, distinct dog facts. Each fact must be a single ' +
          'line with no numbering, no bullet points, and no line breaks inside it.',
      },
      {
        role: 'user',
        content:
          `Give me ${count} interesting and distinct facts about dogs. ` +
          `Respond only with JSON of the form {"facts": ["fact one", "fact two", ...]} ` +
          `containing exactly ${count} facts.`,
      },
    ],
    temperature: 0.8,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);

  let response;
  try {
    response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CONFIG.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${CONFIG.requestTimeoutMs}ms`);
    }
    throw new Error(`Network error calling OpenAI: ${err.message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const detail = await safeReadError(response);
    // 429 and 5xx are the retryable ones; signal that to the caller.
    const retryable = response.status === 429 || response.status >= 500;
    const error = new Error(
      `OpenAI API returned ${response.status} ${response.statusText}: ${detail}`
    );
    error.retryable = retryable;
    throw error;
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenAI response contained no message content.');
  }

  return parseFacts(content);
}

/** Pull the error body out of a failed response without throwing again. */
async function safeReadError(response) {
  try {
    const text = await response.text();
    return text.slice(0, 500);
  } catch {
    return '<unreadable error body>';
  }
}

// ---- Parsing & validation --------------------------------------------------

/** Parse the JSON content into a clean array of one-line fact strings. */
function parseFacts(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Model did not return valid JSON: ${err.message}`);
  }

  const facts = parsed.facts;
  if (!Array.isArray(facts)) {
    throw new Error('Parsed JSON did not contain a "facts" array.');
  }

  return facts
    .map(normalizeFact)
    .filter((f) => f.length > 0);
}

/** Trim, collapse whitespace/newlines, and strip any stray list markers. */
function normalizeFact(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .replace(/\s+/g, ' ')            // collapse internal newlines/spaces
    .replace(/^\s*(?:\d+[.)]|[-*•])\s*/, '') // strip leading "1." / "-" / "•"
    .trim();
}

/** Case-insensitive dedupe that preserves first-seen order. */
function dedupe(facts) {
  const seen = new Set();
  const result = [];
  for (const fact of facts) {
    const key = fact.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(fact);
    }
  }
  return result;
}

// ---- Orchestration ---------------------------------------------------------

/**
 * Collect facts until we reach the target count, deduplicating across
 * attempts and topping up if the model returns too few or duplicates.
 */
async function collectFacts() {
  let facts = [];

  for (let attempt = 1; attempt <= CONFIG.maxAttempts; attempt++) {
    const remaining = CONFIG.targetCount - facts.length;
    // Over-ask slightly so dedupe still leaves us enough.
    const requestCount = Math.min(CONFIG.targetCount, remaining + 5);

    try {
      const batch = await fetchDogFacts(requestCount);
      facts = dedupe([...facts, ...batch]);
      console.log(
        `Attempt ${attempt}: have ${facts.length}/${CONFIG.targetCount} unique facts.`
      );
    } catch (err) {
      if (err.retryable && attempt < CONFIG.maxAttempts) {
        const backoffMs = 1000 * attempt;
        console.warn(`  Retryable error: ${err.message}. Backing off ${backoffMs}ms.`);
        await sleep(backoffMs);
        continue;
      }
      throw err;
    }

    if (facts.length >= CONFIG.targetCount) break;
  }

  if (facts.length < CONFIG.targetCount) {
    throw new Error(
      `Only obtained ${facts.length} unique facts after ${CONFIG.maxAttempts} attempts ` +
        `(needed ${CONFIG.targetCount}).`
    );
  }

  // Trim to exactly the target in case the last batch overshot.
  return facts.slice(0, CONFIG.targetCount);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- Output ----------------------------------------------------------------

async function writeFacts(facts, outputFile) {
  const absolute = path.resolve(outputFile);
  const contents = facts.join('\n') + '\n';
  await fs.writeFile(absolute, contents, 'utf8');
  return absolute;
}

// ---- Entry point -----------------------------------------------------------

async function main() {
  if (!CONFIG.apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is not set.');
    process.exit(1);
  }

  console.log(`Generating ${CONFIG.targetCount} dog facts with model "${CONFIG.model}"...`);

  const facts = await collectFacts();
  const outputPath = await writeFacts(facts, CONFIG.outputFile);

  console.log(`\nDone. Wrote ${facts.length} facts to ${outputPath}`);
}

main().catch((err) => {
  console.error(`\nFailed: ${err.message}`);
  process.exit(1);
});
