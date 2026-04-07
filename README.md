# Gemma4Code CLI

Beautiful Node.js CLI client for talking to your own OpenAI-compatible AI server from the terminal.

## Features

- Streaming AI replies
- OpenAI-compatible server support
- Interactive multiline input
- Slash commands for model and prompt control
- Local session history saving
- Clean terminal UI with colors and panels
- OpenAI-style tools + embeddings relay
- Local RAG support via `/v1/embeddings`

## Setup

1. Install dependencies:

```powershell
npm.cmd install
```

2. Create `.env` from `.env.example` and set your key:

```env
OPENAI_BASE_URL=http://79.76.35.116:8000/v1
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gemma-4
```

3. Start:

```powershell
npm.cmd run start
```

## Relay Backend

`server/py.py` is the public OpenAI-compatible relay. It exposes:

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /health`
- `WS /ai-connect`

Install and run:

```powershell
python -m pip install -r server/requirements.txt
python server/py.py
```

## Colab Worker

`colab/py.py` is the remote worker. It connects to the relay websocket, forwards chat requests to a local OpenAI-compatible model backend such as KoboldCpp, and serves embeddings from `sentence-transformers`.

Install and run:

```python
pip install -r colab/requirements.txt
python colab/py.py
```

Environment knobs:

- `SKIP_KOBOLD_START=1` to use an already running local backend
- `KOBOLD_URL` to point at another OpenAI-compatible inference server
- `EMBED_MODEL_NAME` to change the embedding model

## Commands

- `/help`
- `/model llama-3.1-70b`
- `/system You are a brutally effective coding assistant.`
- `/status`
- `/clear`
- `/save`
- `/exit`

## Notes

- The server must expose an OpenAI-compatible API.
- By default the CLI pings `GET /models` on startup to verify connectivity.
- The relay now expects a connected colab worker for both chat and embeddings.
- If your inference backend does not emit tool calls, the model still will not become tool-capable by prompt alone; the backend must support OpenAI tool calling semantics.
