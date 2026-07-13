# Fifty Dog Facts

A small reference integration with the OpenAI API. It generates exactly 50
distinct dog facts and writes them to a text file, one fact per line.

## Requirements

- Node.js 18 or newer (uses the built-in global `fetch` — no npm install needed)
- An OpenAI API key

## Setup

Set your API key as an environment variable.

**macOS / Linux (bash):**
```bash
export OPENAI_API_KEY="sk-..."
```

**Windows (PowerShell):**
```powershell
$env:OPENAI_API_KEY = "sk-..."
```

## Run

```bash
node fifty-dog-facts.js
```

This writes `dog_facts.txt` in the current directory. To choose a different
output file:

```bash
node fifty-dog-facts.js my-facts.txt
```

Optionally override the model (defaults to `gpt-4o-mini`):

```bash
# PowerShell
$env:OPENAI_MODEL = "gpt-4o"
```

## How it works

1. Reads the API key from `OPENAI_API_KEY` (fails fast if missing).
2. Calls the Chat Completions endpoint in JSON mode so the response is reliably
   parseable rather than free-form prose.
3. Parses and normalizes the facts (collapses line breaks, strips stray list
   markers) and deduplicates them case-insensitively.
4. If a call returns too few unique facts, it tops up with additional calls
   (with backoff on rate limits / 5xx errors) up to a retry limit.
5. Trims to exactly 50 and writes one fact per line to the output file.

## Notes for graders

- The API key is read from the environment, never hard-coded or logged.
- Both `.env` files and the generated `dog_facts.txt` are gitignored.
- Network errors, timeouts, rate limits (429), and malformed model output are
  all handled explicitly, and the process exits non-zero on failure.
