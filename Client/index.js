#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const DEFAULT_SERVER_URL = process.env.SERVER_URL || `http://${process.env.SERVER_IP || '79.76.35.116'}:${process.env.SERVER_PORT || '8000'}`;
const API_KEY = process.env.SERVER_API_KEY || 'sk-gemma4code-relay-key-2025';
const DEFAULT_MODEL = process.env.CLIENT_MODEL || process.env.CHAT_MODEL_ID || 'gemma-4';
const CHUNK_SIZE = 300;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEBUG_LOG_FILE = path.join(__dirname, 'tool-debug.jsonl');
const TOOL_NOISE_PATTERNS = [
  /<\|tool_call\|>/i,
  /<\|tool_call>/i,
  /call\s*:\s*(Readfile|Apply_patch|CreateFile|dir)\s*\{/i,
  /\btool_call\b/i,
];
const CREATE_FILE_HINTS = [
  /\b(create|make|build|generate|write|new)\b/i,
  /\b(site|website|web page|landing page)\b/i,
  /\b(Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р В РІР‚С™Р РЋРЎв„ў|Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В·Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р В РІР‚С™Р РЋРЎв„ў|Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р В РІР‚С™Р РЋРЎС™Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¬Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’В)\b/i,
  /\b(Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В Р вЂ№Р В Р вЂ Р В РІР‚С™Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В°Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†Р вЂљРЎвЂќР В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р В РІР‚С™Р РЋРЎв„ўР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂє|Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р В Р вЂ№Р В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂєР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В»|Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљР’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р РЋРІвЂћСћР В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В¦Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’ВµР В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРІР‚С”\s*Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р В РІР‚в„–Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р РЋРІР‚С”Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р Р‹Р Р†РІР‚С›РЎС›Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р вЂ Р В РІР‚С™Р Р†РІР‚С›РЎС›Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В»Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р Р‹Р РЋРІР‚С”Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В РІР‚в„ўР вЂ™Р’В)\b/i,
];

const args = parseArgs(process.argv.slice(2));
const workspaceRoot = path.resolve(args.root || process.cwd());
const serverUrl = args.server || DEFAULT_SERVER_URL;
const model = args.model || DEFAULT_MODEL;
const systemPrompt = args.system || buildSystemPrompt();
const initialPrompt = args.prompt;
let activeBaseDir = workspaceRoot;

const messages = [
  { role: 'system', content: systemPrompt },
];

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'Readfile',
      description: 'Read one 300-line chunk from a file only. Readfile is observation only: it never edits, creates, or confirms a change. Use chunkIndex 0-based. Multiple Readfile calls may be emitted in one assistant turn when you need several regions.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root. Leading slash is allowed.' },
          chunkIndex: { type: 'integer', minimum: 0, description: '0-based chunk index, where each chunk is 300 lines.' },
        },
        required: ['path', 'chunkIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Apply_patch',
      description: 'Modify an existing file only by replacing a line range. This is the only tool that edits an existing file. Multiple Apply_patch calls may be emitted in one assistant turn for separate files or ranges.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root. Leading slash is allowed.' },
          startLine: { type: 'integer', minimum: 1, description: '1-based start line, inclusive.' },
          endLine: { type: 'integer', minimum: 1, description: '1-based end line, inclusive.' },
          code: { type: 'string', description: 'Replacement code for the selected line range.' },
        },
        required: ['path', 'startLine', 'endLine', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'CreateFile',
      description: 'Create a new file from scratch. Use this for brand-new files only, never for an existing file. Multiple CreateFile calls may be emitted in one assistant turn when a task needs several new files.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root. Leading slash is allowed.' },
          code: { type: 'string', description: 'Full file content.' },
        },
        required: ['path', 'code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'dir',
      description: 'List folders and files recursively from the active directory without code contents. dir is discovery only and never reads file contents. Use it before edits and when you need repository shape.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
  },
];

async function main() {
  await appendDebug('startup', {
    workspaceRoot,
    activeBaseDir,
    serverUrl,
    model,
    debugLogFile: DEBUG_LOG_FILE,
  });
  printBanner();
  await ensureRootExists(workspaceRoot);
  console.log(`Root: ${workspaceRoot}`);
  console.log(`Server: ${serverUrl}`);
  console.log(`Model: ${model}`);
  console.log('');

  if (initialPrompt) {
    await runTurnStrict(initialPrompt);
  } else {
    await interactiveLoop();
  }
}

async function interactiveLoop() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  while (true) {
    const input = await ask('gemma4code> ');
    const trimmed = input.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith('/dir ')) {
      const target = trimmed.slice(5).trim();
      try {
        const resolved = setActiveBaseDir(target);
        console.log(`[CTX] active directory: ${path.relative(workspaceRoot, activeBaseDir) || '.'}`);
        await appendDebug('set_active_dir', { input: target, resolved, activeBaseDir });
      } catch (error) {
        console.log(`[CTX] ${error.message}`);
        await appendDebug('set_active_dir_error', { input: target, error: serializeError(error) });
      }
      continue;
    }
    if (trimmed === '/dir') {
      console.log(`[CTX] active directory: ${path.relative(workspaceRoot, activeBaseDir) || '.'}`);
      continue;
    }
    if (trimmed === 'exit' || trimmed === 'quit' || trimmed === ':q') {
      rl.close();
      break;
    }
    await runTurnStrict(trimmed);
  }
}

async function runTurn(userInput) {
  const turnId = createTurnId();
  const turnPolicy = buildTurnPolicy(userInput);
  await appendDebug('turn_start', {
    turnId,
    userInput,
    activeBaseDir,
    turnPolicy,
  });
  messages.push({ role: 'user', content: userInput });

  for (let step = 0; step < 20; step += 1) {
    const result = await callModelStrict(messages, turnPolicy, turnId);
    await appendDebug('turn_model_result', {
      turnId,
      step,
      content: result.content,
      toolCalls: summarizeToolCalls(result.toolCalls),
      looksLikeToolNoise: looksLikeToolNoise(result.content),
    });

    if (result.toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const toolCall of result.toolCalls) {
        const output = await executeTool(toolCall, turnId);
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: output,
        });
      }

      continue;
    }

    if (turnPolicy.forceCreateFile && isHtmlLike(result.content)) {
      const code = extractHtmlDocument(result.content);
      const output = await toolCreateFile({
        path: turnPolicy.preferredPath,
        code,
      }, turnId, { source: 'html_fallback' });
      messages.push({ role: 'assistant', content: result.content });
      messages.push({
        role: 'tool',
        tool_call_id: `local_create_${Date.now()}`,
        content: output,
      });
      await appendDebug('turn_html_fallback_create', {
        turnId,
        path: turnPolicy.preferredPath,
        codePreview: previewText(code),
      });
      console.log(`[PROTO] created ${turnPolicy.preferredPath} from assistant HTML text`);
      return;
    }

    if (looksLikeToolNoise(result.content)) {
      const repairMessage = buildToolRepairMessage(result.content);
      messages.push({ role: 'assistant', content: result.content });
      messages.push({ role: 'user', content: repairMessage });
      await appendDebug('turn_tool_noise', { turnId, repairMessage, content: result.content });
      console.log('[PROTO] model emitted raw tool markup, requesting proper tool call');
      continue;
    }

    if (turnPolicy.forceCreateFile && result.content.trim()) {
      const fallbackCode = buildDeterministicFileContent(userInput, result.content);
      const output = await toolCreateFile(
        {
          path: turnPolicy.preferredPath,
          code: fallbackCode,
        },
        turnId,
        { source: 'deterministic_fallback' }
      );
      messages.push({ role: 'assistant', content: result.content });
      messages.push({
        role: 'tool',
        tool_call_id: `local_create_${Date.now()}`,
        content: output,
      });
      await appendDebug('turn_deterministic_fallback_create', {
        turnId,
        path: turnPolicy.preferredPath,
        codePreview: previewText(fallbackCode),
      });
      console.log(`[PROTO] created ${turnPolicy.preferredPath} from fallback template`);
      return;
    }

    if (result.content.trim()) {
      process.stdout.write(`${result.content}\n`);
    }

    messages.push({
      role: 'assistant',
      content: result.content,
    });
    await appendDebug('turn_complete_text', { turnId, content: result.content });
    return;
  }

  await appendDebug('turn_loop_exceeded', { userInput });
  throw new Error('Tool loop exceeded 20 steps.');
}

async function callModel(conversation, turnPolicy = null, turnId = '') {
  const toolChoice = turnPolicy?.forceCreateFile
    ? { type: 'function', function: { name: 'CreateFile' } }
    : 'auto';
  const callMessages = turnPolicy?.instruction
    ? [...conversation, { role: 'system', content: turnPolicy.instruction }]
    : conversation;
  const requestBody = {
    model,
    messages: callMessages,
    stream: true,
    tools: toolDefinitions,
    tool_choice: toolChoice,
  };

  await appendDebug('model_request', {
    turnId,
    toolChoice,
    messageCount: callMessages.length,
    messages: callMessages,
    activeBaseDir,
  });

  let response;
  try {
    response = await fetch(`${serverUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    await appendDebug('model_request_failed', {
      turnId,
      requestBody,
      error: serializeError(error),
    });
    throw error;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    await appendDebug('model_request_failed', {
      turnId,
      status: response.status,
      responseText: text,
    });
    throw new Error(`Model request failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let toolCalls = [];
  let printedContent = false;
  let sawToolNoise = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const separator = buffer.indexOf('\n\n');
      if (separator === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const dataLines = rawEvent.split('\n').filter((line) => line.startsWith('data: '));
      for (const line of dataLines) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          continue;
        }

        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0] || {};
        const delta = choice.delta || {};
        await appendDebug('model_delta', {
          turnId,
          delta,
          finishReason: choice.finish_reason || null,
        });

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content;
          if (!toolCalls.length && !looksLikeToolNoise(content)) {
            process.stdout.write(delta.content);
            printedContent = true;
          } else if (looksLikeToolNoise(content)) {
            sawToolNoise = true;
          }
        }

        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
          toolCalls = mergeToolCalls(toolCalls, delta.tool_calls);
        }
      }
    }
  }

  if (printedContent && !sawToolNoise) {
    process.stdout.write('\n');
  }

  await appendDebug('model_complete', {
    turnId,
    content,
    toolCalls: summarizeToolCalls(toolCalls),
    sawToolNoise,
  });
  return { content, toolCalls };
}

async function executeTool(toolCall, turnId = '') {
  const name = toolCall.function?.name || '';
  const rawArgs = toolCall.function?.arguments || '{}';
  const args = safeJsonParse(rawArgs);
  await appendDebug('tool_call_start', { turnId, name, rawArgs, args });

  switch (name) {
    case 'Readfile':
      return await toolReadfile(args, turnId, { toolCallId: toolCall.id });
    case 'Apply_patch':
      return await toolApplyPatch(args, turnId, { toolCallId: toolCall.id });
    case 'CreateFile':
      return await toolCreateFile(args, turnId, { toolCallId: toolCall.id });
    case 'dir':
      return await toolDir(args, turnId, { toolCallId: toolCall.id });
    default:
      const output = formatToolOutput(name || 'unknown', 'Unsupported tool call.');
      await appendDebug('tool_call_unknown', { turnId, name, output });
      return output;
  }
}

async function toolReadfile(args, turnId = '', meta = {}) {
  const filePath = resolveWorkspacePath(args.path);
  const chunkIndex = Number(args.chunkIndex || 0);
  const relative = path.relative(activeBaseDir, filePath) || path.basename(filePath);
  try {
    const text = await fs.readFile(filePath, 'utf8');
    const lines = splitLines(text);
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, lines.length);
    const displayEnd = end > start ? end : start + 1;
    const selected = lines.slice(start, end).join('\n');
    console.log(`[Tool] Readfile -> ${relative} chunk ${chunkIndex} (${start + 1}-${displayEnd})`);
    const output = formatCodeOutput(
      'Readfile',
      relative,
      `chunk ${chunkIndex}`,
      `lines ${start + 1}-${displayEnd}`,
      selected,
      'observation only'
    );
    await appendDebug('tool_readfile_result', {
      turnId,
      ...meta,
      filePath,
      relative,
      chunkIndex,
      startLine: start + 1,
      endLine: displayEnd,
      lineCount: lines.length,
      codePreview: previewText(selected),
    });
    return output;
  } catch (error) {
    const message = `status: error\nerror: ${error.message}`;
    const output = formatToolOutput('Readfile', relative, `chunk ${chunkIndex}`, 'read failed', message, 'observation only');
    await appendDebug('tool_readfile_error', {
      turnId,
      ...meta,
      filePath,
      relative,
      chunkIndex,
      error: serializeError(error),
    });
    return output;
  }
}

async function toolApplyPatch(args, turnId = '', meta = {}) {
  const filePath = resolveWorkspacePath(args.path);
  const startLine = Number(args.startLine);
  const endLine = Number(args.endLine);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine) {
    const error = new Error('Invalid line range for Apply_patch.');
    await appendDebug('tool_apply_patch_error', { turnId, ...meta, filePath, startLine, endLine, error: serializeError(error) });
    throw error;
  }

  const relative = path.relative(activeBaseDir, filePath) || path.basename(filePath);
  try {
    const original = await fs.readFile(filePath, 'utf8');
    const lines = splitLines(original);
    if (startLine > lines.length + 1) {
      throw new Error(`Start line ${startLine} is beyond file length ${lines.length}.`);
    }

    const before = lines.slice(0, startLine - 1);
    const after = lines.slice(endLine);
    const replacement = splitLines(String(args.code ?? ''));
    const updated = [...before, ...replacement, ...after].join('\n');
    await fs.writeFile(filePath, updated, 'utf8');

    console.log(`[Tool] Apply_patch -> ${relative} lines ${startLine}-${endLine} replaced ${endLine - startLine + 1} lines`);
    const output = formatToolOutput(
      'Apply_patch',
      relative,
      `lines ${startLine}-${endLine}`,
      `replaced ${endLine - startLine + 1} lines`,
      `status: applied\nnew_lines: ${replacement.length}`,
      'write'
    );
    await appendDebug('tool_apply_patch_result', {
      turnId,
      ...meta,
      filePath,
      relative,
      startLine,
      endLine,
      originalLineCount: lines.length,
      replacementLineCount: replacement.length,
      codePreview: previewText(String(args.code ?? '')),
    });
    return output;
  } catch (error) {
    await appendDebug('tool_apply_patch_error', { turnId, ...meta, filePath, startLine, endLine, error: serializeError(error) });
    return formatToolOutput('Apply_patch', relative, `lines ${startLine}-${endLine}`, 'patch failed', `status: error\nerror: ${error.message}`, 'write');
  }
}

async function toolCreateFile(args, turnId = '', meta = {}) {
  const filePath = resolveWorkspacePath(args.path);
  const relative = path.relative(activeBaseDir, filePath) || path.basename(filePath);
  try {
    const existing = await fs.stat(filePath);
    if (existing.isFile()) {
      throw new Error(`CreateFile refused to overwrite existing file: ${path.relative(activeBaseDir, filePath) || path.basename(filePath)}`);
    }
    throw new Error(`CreateFile target already exists and is not a file: ${path.relative(activeBaseDir, filePath) || path.basename(filePath)}`);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      if (!String(error.message || '').includes('refused to overwrite')) {
        await appendDebug('tool_create_file_error', {
          turnId,
          ...meta,
          filePath,
          relative,
          error: serializeError(error),
        });
        return formatToolOutput('CreateFile', relative, 'new file', 'create failed', `status: error\nerror: ${error.message}`, 'write');
      }
      await appendDebug('tool_create_file_error', {
        turnId,
        ...meta,
        filePath,
        relative,
        error: serializeError(error),
      });
      return formatToolOutput('CreateFile', relative, 'new file', 'create failed', `status: error\nerror: ${error.message}`, 'write');
    }
  }

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const content = String(args.code ?? '');
    await fs.writeFile(filePath, content, 'utf8');

    const lineCount = splitLines(content).length;
    console.log(`[Tool] CreateFile -> ${relative} created ${lineCount} lines`);
    const output = formatToolOutput('CreateFile', relative, 'new file', `created ${lineCount} lines`, 'status: created', 'write');
    await appendDebug('tool_create_file_result', {
      turnId,
      ...meta,
      filePath,
      relative,
      lineCount,
      codePreview: previewText(content),
    });
    return output;
  } catch (error) {
    await appendDebug('tool_create_file_error', {
      turnId,
      ...meta,
      filePath,
      relative,
      error: serializeError(error),
    });
    return formatToolOutput('CreateFile', relative, 'new file', 'create failed', `status: error\nerror: ${error.message}`, 'write');
  }
}

async function toolDir(_args = {}, turnId = '', meta = {}) {
  console.log('[Tool] dir -> listing workspace tree');
  const tree = await buildTree(activeBaseDir, '');
  const label = path.relative(workspaceRoot, activeBaseDir) || '.';
  const output = formatToolOutput('dir', label, 'workspace tree', 'no code', tree.join('\n'));
  await appendDebug('tool_dir_result', {
    turnId,
    ...meta,
    activeBaseDir,
    treePreview: previewText(tree.join('\n'), 1000),
  });
  return output;
}

async function buildTree(currentPath, prefix) {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  entries.sort((a, b) => {
    if (a.isDirectory() !== b.isDirectory()) {
      return a.isDirectory() ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  const lines = [];
  for (const entry of entries) {
    const marker = entry.isDirectory() ? '/' : '';
    lines.push(`${prefix}${entry.name}${marker}`);
    if (entry.isDirectory()) {
      const childPath = path.join(currentPath, entry.name);
      const childLines = await buildTree(childPath, `${prefix}  `);
      lines.push(...childLines);
    }
  }

  return lines;
}

function formatToolOutput(toolName, fileLabel, chunkLabel, metaLabel, code, mode = '') {
  return [
    `[Meta]`,
    `Tool: ${toolName}`,
    `File: ${fileLabel}`,
    `Chunk: ${chunkLabel}`,
    `Details: ${metaLabel}`,
    mode ? `Mode: ${mode}` : null,
    '[Code]',
    code || '',
  ].filter(Boolean).join('\n');
}

function formatCodeOutput(toolName, fileLabel, chunkLabel, metaLabel, code, mode = '') {
  return [
    `[Meta]`,
    `Tool: ${toolName}`,
    `File: ${fileLabel}`,
    `Chunk: ${chunkLabel}`,
    `Details: ${metaLabel}`,
    mode ? `Mode: ${mode}` : null,
    '[Code]',
    code || '',
  ].filter(Boolean).join('\n');
}

function mergeToolCalls(existing, deltaCalls) {
  const merged = existing.map((item) => structuredClone(item));

  for (const delta of deltaCalls) {
    const index = Number.isInteger(delta.index) ? delta.index : merged.length;
    while (merged.length <= index) {
      merged.push({ id: '', type: 'function', function: { name: '', arguments: '' } });
    }

    const current = merged[index];
    if (delta.id) {
      current.id = delta.id;
    }
    if (delta.type) {
      current.type = delta.type;
    }

    const functionDelta = delta.function || {};
    current.function ||= { name: '', arguments: '' };
    if (functionDelta.name) {
      current.function.name += functionDelta.name;
    }
    if (functionDelta.arguments) {
      current.function.arguments += functionDelta.arguments;
    }
  }

  return merged;
}

function buildSystemPrompt() {
  return [
    'You are a production-grade coding agent for this repository.',
    'Your job is to inspect, plan, modify, verify, and finish tasks without hand-holding.',
    'When file work is needed, use tools instead of narrating the steps.',
    'Multiple tool calls in one assistant turn are allowed and preferred when they are independent.',
    'For example, you may emit several Readfile calls for different chunks, or several Apply_patch/CreateFile calls for separate files, in the same assistant message.',
    'Readfile is observation only. It never changes a file, never proves a file changed, and must never be used as if it were a write tool.',
    'Apply_patch is the only tool that edits an existing file.',
    'CreateFile is the only tool that creates a brand-new file.',
    'dir is discovery only. It reveals tree shape, not file contents.',
    'Use a tool call immediately when the user wants inspection, creation, or edits.',
    'Do not output tool syntax, raw JSON, pseudo-tool blocks, or tool markup in normal assistant text.',
    'Do not claim a file was modified until a write tool confirms it.',
    'Do not claim verification until you actually re-read the file or otherwise inspect the result.',
    'Recommended workflow:',
    '- inspect the workspace with dir',
    '- read the relevant file chunks with Readfile',
    '- patch only the exact line ranges that need changes',
    '- read the same region again to verify',
    '- continue until the task is complete',
    'Behavior rules:',
    '- Prefer the smallest correct set of tools, but do not artificially limit yourself to one tool call per turn.',
    '- If several files must change, you may change them in sequence without waiting for a user reply.',
    '- If a task is ambiguous, inspect first and decide from repository evidence.',
    '- Use concise assistant text only when no tool is needed or after all tool work is complete.',
    '- In the CLI, /dir <path> changes the active base folder before you ask for edits.',
    '- File paths are relative to the workspace root unless absolute paths are explicitly needed.',
    '- Readfile chunks are 300 lines each and are numbered from 0.',
    '- Keep tool calls targeted and deterministic.',
  ].join('\n');
}

function buildTurnPolicy(userInput) {
  const text = String(userInput || '');
  const forceCreateFile = CREATE_FILE_HINTS.some((pattern) => pattern.test(text));
  if (!forceCreateFile) {
    return { forceCreateFile: false };
  }

  return {
    forceCreateFile: true,
    preferredPath: guessCreatePath(text),
    instruction: [
      'This is a file-creation task.',
      `Use CreateFile for ${guessCreatePath(text)} and any other required new files.`,
      'Return no prose until the required tool work is done.',
      'Do not output tool markup or explain the file in plain text.',
      'If the user asked for a simple page without specifying a filename, use index.html.',
    ].join('\n'),
  };
}

function parseArgs(argv) {
  const result = { prompt: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--root' && argv[index + 1]) {
      result.root = argv[++index];
      continue;
    }
    if (arg === '--server' && argv[index + 1]) {
      result.server = argv[++index];
      continue;
    }
    if (arg === '--model' && argv[index + 1]) {
      result.model = argv[++index];
      continue;
    }
    if (arg === '--system' && argv[index + 1]) {
      result.system = argv[++index];
      continue;
    }
    result.prompt.push(arg);
  }
  result.prompt = result.prompt.join(' ').trim();
  return result;
}

function resolveWorkspacePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    throw new Error('Missing file path.');
  }

  if (isAbsolutePath(inputPath)) {
    return path.resolve(inputPath);
  }

  const normalized = inputPath.replace(/^\/+/, '').replace(/\\/g, '/');
  return path.resolve(activeBaseDir, normalized);
}

function setActiveBaseDir(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    activeBaseDir = workspaceRoot;
    return activeBaseDir;
  }

  const resolved = isAbsolutePath(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(workspaceRoot, inputPath.replace(/^\/+/, '').replace(/\\/g, '/'));
  activeBaseDir = resolved;
  return activeBaseDir;
}

function splitLines(text) {
  if (!text) {
    return [];
  }
  return String(text).split(/\r?\n/);
}

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function isAbsolutePath(inputPath) {
  return path.isAbsolute(inputPath) || /^[A-Za-z]:[\\/]/.test(inputPath) || inputPath.startsWith('\\\\');
}

function looksLikeToolNoise(text) {
  if (!text) {
    return false;
  }
  return TOOL_NOISE_PATTERNS.some((pattern) => pattern.test(text));
}

function guessCreatePath(text) {
  if (/\bpython\b/i.test(text) && /\b(game|игр|игру|app|script|bot|server)\b/i.test(text)) {
    return 'main.py';
  }
  if (/\.html?\b/i.test(text) || /\bhtml\b/i.test(text)) {
    return 'index.html';
  }
  if (/\bcs2\b/i.test(text) || /\bsite\b/i.test(text)) {
    return 'index.html';
  }
  return 'index.html';
}

function guessEditPath(text) {
  const value = String(text || '');
  const explicitPath = value.match(/([^\s"'`]+?\.(?:py|js|ts|tsx|jsx|html?|css|json|md|txt|yml|yaml|toml|ini|cjs|mjs))/i);
  if (explicitPath) {
    return explicitPath[1].replace(/\\/g, '/');
  }
  return guessCreatePath(value);
}

function isHtmlLike(text) {
  const value = String(text || '');
  return /<!doctype html>/i.test(value) || /<html[\s>]/i.test(value) || /<body[\s>]/i.test(value);
}

function extractHtmlDocument(text) {
  const value = String(text || '').trim();
  const startIndex = value.search(/<!doctype html>|<html[\s>]/i);
  if (startIndex >= 0) {
    const candidate = value.slice(startIndex);
    const endIndex = candidate.toLowerCase().lastIndexOf('</html>');
    if (endIndex >= 0) {
      return candidate.slice(0, endIndex + 7);
    }
    return candidate;
  }

  const fenced = value.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenced) {
    return fenced[1].trim();
  }

  return value;
}

function buildDeterministicFileContent(userInput, assistantText) {
  const input = String(userInput || '').toLowerCase();
  if (input.includes('html') || input.includes('site') || input.includes('page')) {
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="UTF-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
      '  <title>Hello World</title>',
      '  <style>',
      '    :root { color-scheme: dark; }',
      '    * { box-sizing: border-box; }',
      '    body {',
      '      margin: 0;',
      '      min-height: 100vh;',
      '      display: grid;',
      '      place-items: center;',
      '      background: radial-gradient(circle at top, #1f2937, #0f172a 55%, #020617);',
      '      font-family: Arial, Helvetica, sans-serif;',
      '      color: #f8fafc;',
      '    }',
      '    .hero {',
      '      text-align: center;',
      '      padding: 32px 40px;',
      '      border: 1px solid rgba(255,255,255,0.12);',
      '      border-radius: 24px;',
      '      background: rgba(15, 23, 42, 0.55);',
      '      backdrop-filter: blur(12px);',
      '      box-shadow: 0 24px 80px rgba(0,0,0,0.35);',
      '    }',
      '    h1 {',
      '      margin: 0;',
      '      font-size: clamp(2.5rem, 8vw, 6rem);',
      '      letter-spacing: 0.04em;',
      '    }',
      '    p {',
      '      margin: 12px 0 0;',
      '      font-size: 1rem;',
      '      color: #cbd5e1;',
      '    }',
      '  </style>',
      '</head>',
      '<body>',
      '  <main class="hero">',
      '    <h1>Hello World</h1>',
      '    <p>Centered on the screen.</p>',
      '  </main>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }

  const fallback = extractHtmlDocument(assistantText);
  if (isHtmlLike(fallback)) {
    return fallback;
  }

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>Hello World</title>',
    '</head>',
    '<body>',
    '  <h1>Hello World</h1>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

function createTurnId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function summarizeToolCalls(toolCalls) {
  return (toolCalls || []).map((toolCall) => ({
    id: toolCall.id || null,
    name: toolCall.function?.name || '',
    argumentsPreview: previewText(toolCall.function?.arguments || ''),
  }));
}

function previewText(value, limit = 240) {
  const text = String(value ?? '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}...`;
}

async function appendDebug(event, data = {}) {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  try {
    await fs.appendFile(DEBUG_LOG_FILE, `${JSON.stringify(entry)}\n`);
  } catch (error) {
    console.error(`[DEBUG_LOG_ERROR] ${error.message}`);
  }
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: error?.stack || '',
  };
}

function buildToolRepairMessage(noisyText) {
  return [
    'Your previous assistant message contained raw tool markup instead of a real tool call.',
    'Do not print tool syntax to the user.',
    'Respond only with valid tool calls if you need a tool, or with a short plain answer if no tool is needed.',
    `Invalid content that must not be repeated: ${truncateForPrompt(noisyText, 400)}`,
  ].join('\n');
}

function buildToolRepairMessageStrict(noisyText, requiredTool) {
  const baseMessage = [
    'Your previous assistant message contained raw tool markup instead of a real tool call.',
    'Do not print tool syntax to the user.',
    'Respond only with valid tool calls if you need a tool, or with a short plain answer if no tool is needed.',
  ];
  
  if (requiredTool) {
    baseMessage.push(`You must use the ${requiredTool} tool now.`);
  }
  
  baseMessage.push(`Invalid content that must not be repeated: ${truncateForPrompt(noisyText, 400)}`);
  
  return baseMessage.join('\n');
}

function truncateForPrompt(text, limit) {
  const value = String(text || '');
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}...`;
}

async function ensureRootExists(rootPath) {
  const stat = await fs.stat(rootPath);
  if (!stat.isDirectory()) {
    throw new Error(`Workspace root is not a directory: ${rootPath}`);
  }
}

function printBanner() {
  console.log('========================================');
  console.log('Gemma4Code CLI Agent');
  console.log('Tools: Readfile, Apply_patch, CreateFile, dir');
  console.log(`Active dir: ${path.relative(workspaceRoot, activeBaseDir) || '.'}`);
  console.log('========================================');
}

main().catch((error) => {
  console.error(`[FATAL] ${error.stack || error.message || String(error)}`);
  process.exit(1);
});

function looksLikeCreateIntent(text) {
  const value = String(text || '');
  return [
    /\b(create|make|build|generate|write|new|createfile)\b/i,
    /\b(site|website|web page|landing page|page|app|script|bot|server|game|html|hello world)\b/i,
    /\b(сделай|создай|напиши|игру|игра|пайгейм|редактируй|измени|обнови|исправь|замени)\b/i,
  ].some((pattern) => pattern.test(value));
}

function looksLikeEditIntent(text) {
  const value = String(text || '');
  return [
    /\b(edit|update|change|modify|fix|patch|replace|style|background|gradient|color)\b/i,
    /\b(index\.html|index\s*html|main\.py|app\.py|\.html\b|\.py\b|\.js\b|\.ts\b|\.tsx\b|\.jsx\b)\b/i,
    /\b(сделай|измени|обнови|исправь|замени|редактируй)\b/i,
  ].some((pattern) => pattern.test(value));
}

async function buildTurnPolicyStrict(userInput) {
  const text = String(userInput || '');
  const wantsCreate = looksLikeCreateIntent(text);
  const wantsEdit = looksLikeEditIntent(text);
  const mentionsExistingHtmlFile = /\b(index\.html|index\s*html|main\.py|app\.py|\.html\b|\.py\b)\b/i.test(text);

  if (wantsEdit || mentionsExistingHtmlFile) {
    const target = await findPreferredEditTargetStrict(activeBaseDir);
    if (target.exists) {
      return {
        mode: 'edit',
        forceCreateFile: false,
        requiredTool: 'Apply_patch',
        preferredPath: target.relativePath,
        instruction: [
          'This is a file-edit task.',
          `Use Apply_patch for ${target.relativePath} and any other necessary existing-file edits.`,
          'Return no prose until the required tool work is done.',
          'Do not output tool markup or explain the patch in plain text.',
          'Readfile is allowed to inspect the current file before patching and to verify later.',
          'Never describe a Readfile result as if it changed the file.',
          'Use the current file contents as context and patch the existing file.',
        ].join('\n'),
        targetExists: true,
      };
    }

    return {
      mode: 'edit',
      forceCreateFile: false,
      requiredTool: 'Apply_patch',
      preferredPath: guessEditPath(text),
      createBeforeEdit: true,
      instruction: [
        'This is a file-edit task.',
        `If ${guessEditPath(text)} does not exist, create it first with CreateFile, then apply Apply_patch to that same file.`,
        'Return no prose until the required tool work is done.',
        'Do not output tool markup or explain the patch in plain text.',
        'Readfile is allowed to inspect the current file before patching and to verify later.',
        'Never describe a Readfile result as if it changed the file.',
        'Use the current file contents as context and patch the existing file.',
      ].join('\n'),
    };
  }

  if (wantsCreate) {
    return {
      mode: 'create',
      forceCreateFile: true,
      requiredTool: 'CreateFile',
      preferredPath: guessCreatePath(text),
      instruction: [
        'This is a file-creation task.',
        'Use CreateFile for the required new file(s).',
        'Return no prose until the required tool work is done.',
        'Do not output tool markup or explain the file in plain text.',
        'If the user asked for a simple page without specifying a filename, use index.html.',
      ].join('\n'),
    };
  }

  return {
    mode: 'chat',
    forceCreateFile: false,
    requiredTool: 'none',
  };
}
async function runTurnStrict(userInput) {
  const turnId = createTurnId();
  const turnPolicy = await buildTurnPolicyStrict(userInput);
  await appendDebug('turn_start', {
    turnId,
    userInput,
    activeBaseDir,
    turnPolicy,
  });
  messages.push({ role: 'user', content: userInput });
  if (turnPolicy.mode !== 'chat') {
    await runPreflightStrict(turnId, turnPolicy);
  }

  for (let step = 0; step < 20; step += 1) {
    const result = await callModelStrict(messages, turnPolicy, turnId);
    await appendDebug('turn_model_result', {
      turnId,
      step,
      content: result.content,
      toolCalls: summarizeToolCalls(result.toolCalls),
      looksLikeToolNoise: looksLikeToolNoise(result.content),
    });

    if (result.toolCalls.length) {
      messages.push({
        role: 'assistant',
        content: result.content,
        tool_calls: result.toolCalls,
      });

      for (const toolCall of result.toolCalls) {
        await executeToolStrict(toolCall, turnId, turnPolicy);
      }

      continue;
    }

    if (turnPolicy.mode !== 'chat' && result.content.trim()) {
      const repairMessage = buildToolRepairMessageStrict(
        `${result.content}\n\nYou must use ${turnPolicy.requiredTool} now.`,
        turnPolicy.requiredTool
      );
      messages.push({ role: 'assistant', content: result.content });
      messages.push({ role: 'user', content: repairMessage });
      await appendDebug('turn_text_rejected', {
        turnId,
        mode: turnPolicy.mode,
        requiredTool: turnPolicy.requiredTool,
        content: result.content,
      });
      console.log(`[PROTO] waiting for real ${turnPolicy.requiredTool} tool call`);
      continue;
    }

    if (looksLikeToolNoise(result.content)) {
      const repairMessage = buildToolRepairMessageStrict(result.content, turnPolicy.requiredTool);
      messages.push({ role: 'assistant', content: result.content });
      messages.push({ role: 'user', content: repairMessage });
      await appendDebug('turn_tool_noise', { turnId, repairMessage, content: result.content });
      console.log('[PROTO] model emitted raw tool markup, requesting proper tool call');
      continue;
    }

    if (turnPolicy.forceCreateFile && isHtmlLike(result.content)) {
      const code = extractHtmlDocument(result.content);
      const output = await toolCreateFile({
        path: turnPolicy.preferredPath,
        code,
      }, turnId, { source: 'html_fallback' });
      messages.push({ role: 'assistant', content: result.content });
      messages.push({
        role: 'tool',
        tool_call_id: `local_create_${Date.now()}`,
        content: output,
      });
      await appendDebug('turn_html_fallback_create', {
        turnId,
        path: turnPolicy.preferredPath,
        codePreview: previewText(code),
      });
      console.log(`[PROTO] created ${turnPolicy.preferredPath} from assistant HTML text`);
      return;
    }

    if (turnPolicy.forceCreateFile && result.content.trim()) {
      const fallbackCode = buildDeterministicFileContent(userInput, result.content);
      const output = await toolCreateFile(
        {
          path: turnPolicy.preferredPath,
          code: fallbackCode,
        },
        turnId,
        { source: 'deterministic_fallback' }
      );
      messages.push({ role: 'assistant', content: result.content });
      messages.push({
        role: 'tool',
        tool_call_id: `local_create_${Date.now()}`,
        content: output,
      });
      await appendDebug('turn_deterministic_fallback_create', {
        turnId,
        path: turnPolicy.preferredPath,
        codePreview: previewText(fallbackCode),
      });
      console.log(`[PROTO] created ${turnPolicy.preferredPath} from fallback template`);
      return;
    }

    if (result.content.trim()) {
      process.stdout.write(`${result.content}\n`);
    }

    messages.push({
      role: 'assistant',
      content: result.content,
    });
    await appendDebug('turn_complete_text', { turnId, content: result.content });
    return;
  }

  await appendDebug('turn_loop_exceeded', { userInput });
  throw new Error('Tool loop exceeded 20 steps.');
}

async function runPreflightStrict(turnId, turnPolicy) {
  const dirOutput = await toolDir({}, turnId, { phase: 'preflight' });
  messages.push({
    role: 'tool',
    tool_call_id: `preflight_dir_${turnId}`,
    content: dirOutput,
  });
  await appendDebug('preflight_dir', {
    turnId,
    activeBaseDir,
    mode: turnPolicy.mode,
    preferredPath: turnPolicy.preferredPath || null,
  });

  if (turnPolicy.mode !== 'edit' || !turnPolicy.preferredPath) {
    return;
  }

  try {
    await fs.stat(resolveWorkspacePath(turnPolicy.preferredPath));
  } catch {
    await appendDebug('preflight_readfile_skipped', {
      turnId,
      path: turnPolicy.preferredPath,
      reason: 'target_missing',
    });
    return;
  }

  const preRead = await toolReadfile({ path: turnPolicy.preferredPath, chunkIndex: 0 }, turnId, {
    phase: 'preflight',
    toolCallId: `preflight_read_${turnId}`,
  });
  messages.push({
    role: 'tool',
    tool_call_id: `preflight_read_${turnId}`,
    content: preRead,
  });
  await appendDebug('preflight_readfile', {
    turnId,
    path: turnPolicy.preferredPath,
    chunkIndex: 0,
  });
}

async function executeToolStrict(toolCall, turnId, turnPolicy) {
  const name = toolCall.function?.name || '';
  const rawArgs = toolCall.function?.arguments || '{}';
  const args = safeJsonParse(rawArgs);
  const toolCallId = toolCall.id || `tool_${turnId}`;

  if (name !== 'Apply_patch') {
    const output = await executeTool(toolCall, turnId);
    messages.push({
      role: 'tool',
      tool_call_id: toolCallId,
      content: output,
    });
    return;
  }

  const startLine = Number(args.startLine || 1);
  const chunkIndex = Math.max(0, Math.floor((startLine - 1) / CHUNK_SIZE));
  const filePath = args.path;
  await appendDebug('apply_patch_preflight', {
    turnId,
    toolCallId,
    filePath,
    chunkIndex,
    mode: turnPolicy.mode,
  });

  try {
    await fs.stat(resolveWorkspacePath(filePath));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      const created = await toolCreateFile({ path: filePath, code: '' }, turnId, { phase: 'auto_create_before_patch', toolCallId });
      messages.push({
        role: 'tool',
        tool_call_id: `${toolCallId}:auto_create`,
        content: created,
      });
      await appendDebug('patch_target_autocreated', {
        turnId,
        toolCallId,
        filePath,
        chunkIndex,
      });
    } else {
      await appendDebug('patch_preflight_stat_failed', {
        turnId,
        toolCallId,
        filePath,
        chunkIndex,
        error: serializeError(error),
      });
    }
  }

  try {
    const preRead = await toolReadfile({ path: filePath, chunkIndex }, turnId, {
      phase: 'pre_patch',
      toolCallId,
    });
    messages.push({
      role: 'tool',
      tool_call_id: `${toolCallId}:pre_read`,
      content: preRead,
    });
  } catch (error) {
    await appendDebug('patch_pre_read_failed', {
      turnId,
      toolCallId,
      filePath,
      chunkIndex,
      error: serializeError(error),
    });
  }

  const patchOutput = await executeTool(toolCall, turnId);
  messages.push({
    role: 'tool',
    tool_call_id: toolCallId,
    content: patchOutput,
  });

  try {
    const postRead = await toolReadfile({ path: filePath, chunkIndex }, turnId, {
      phase: 'post_patch',
      toolCallId,
    });
    messages.push({
      role: 'tool',
      tool_call_id: `${toolCallId}:post_read`,
      content: postRead,
    });
    await appendDebug('patch_post_read', {
      turnId,
      toolCallId,
      filePath,
      chunkIndex,
    });
  } catch (error) {
    await appendDebug('patch_post_read_failed', {
      turnId,
      toolCallId,
      filePath,
      chunkIndex,
      error: serializeError(error),
    });
  }
}
async function findPreferredEditTargetStrict(baseDir) {
  const preferredNames = ['index.html', 'index.htm', 'main.html', 'app.html'];
  for (const name of preferredNames) {
    const candidate = path.join(baseDir, name);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return {
          exists: true,
          absolutePath: candidate,
          relativePath: path.relative(activeBaseDir, candidate) || path.basename(candidate),
        };
      }
    } catch {
      // keep searching
    }
  }

  const found = await findFirstHtmlFileStrict(baseDir, 2);
  if (found) {
    return found;
  }

  return {
    exists: false,
    absolutePath: path.join(baseDir, 'index.html'),
    relativePath: 'index.html',
  };
}

async function findFirstHtmlFileStrict(currentDir, depth) {
  if (depth < 0) {
    return null;
  }

  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(currentDir, entry.name);
    if (entry.isFile() && /\.html?$/i.test(entry.name)) {
      return {
        exists: true,
        absolutePath: candidate,
        relativePath: path.relative(activeBaseDir, candidate) || path.basename(candidate),
      };
    }
    if (entry.isDirectory()) {
      const nested = await findFirstHtmlFileStrict(candidate, depth - 1);
      if (nested) {
        return nested;
      }
    }
  }

  return null;
}

async function callModelStrict(conversation, turnPolicy = null, turnId = '') {
  const toolChoice = 'auto';
  const suppressTextStreaming = turnPolicy?.requiredTool && turnPolicy.requiredTool !== 'none';
  const callMessages = turnPolicy?.instruction
    ? [
        ...conversation.slice(0, 1),
        { role: 'system', content: turnPolicy.instruction },
        ...conversation.slice(1),
      ]
    : conversation;
  const requestBody = {
    model,
    messages: callMessages,
    stream: true,
    tools: toolDefinitions,
    tool_choice: toolChoice,
  };

  await appendDebug('model_request', {
    turnId,
    toolChoice,
    messageCount: callMessages.length,
    messages: callMessages,
    activeBaseDir,
  });

  let response;
  try {
    response = await fetch(`${serverUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(requestBody),
    });
  } catch (error) {
    await appendDebug('model_request_failed', {
      turnId,
      requestBody,
      error: serializeError(error),
    });
    throw error;
  }

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    await appendDebug('model_request_failed', {
      turnId,
      status: response.status,
      responseText: text,
    });
    throw new Error(`Model request failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let toolCalls = [];
  let printedContent = false;
  let sawToolNoise = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const separator = buffer.indexOf('\n\n');
      if (separator === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      const dataLines = rawEvent.split('\n').filter((line) => line.startsWith('data: '));
      for (const line of dataLines) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') {
          continue;
        }

        const parsed = JSON.parse(payload);
        const choice = parsed.choices?.[0] || {};
        const delta = choice.delta || {};
        await appendDebug('model_delta', {
          turnId,
          delta,
          finishReason: choice.finish_reason || null,
        });

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          content += delta.content;
          if (!suppressTextStreaming && !toolCalls.length && !looksLikeToolNoise(content)) {
            process.stdout.write(delta.content);
            printedContent = true;
          } else if (looksLikeToolNoise(content)) {
            sawToolNoise = true;
          }
        }

        if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
          toolCalls = mergeToolCalls(toolCalls, delta.tool_calls);
        }
      }
    }
  }

  if (printedContent && !sawToolNoise) {
    process.stdout.write('\n');
  }

  await appendDebug('model_complete', {
    turnId,
    content,
    toolCalls: summarizeToolCalls(toolCalls),
    sawToolNoise,
  });
  return { content, toolCalls };
}
