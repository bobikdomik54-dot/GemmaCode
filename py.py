from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from typing import Any, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

API_KEY = os.environ.get("SERVER_API_KEY", "sk-gemma4code-relay-key-2025")
CHAT_MODEL_ID = os.environ.get("CHAT_MODEL_ID", "gemma-4")

app = FastAPI(title="Gemma OpenAI Relay Server")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
security = HTTPBearer(auto_error=False)

ai_websocket: Optional[WebSocket] = None
pending_requests: dict[str, dict[str, Any]] = {}


def verify_key(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if not credentials or credentials.credentials != API_KEY:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "Incorrect API key.",
                    "type": "invalid_request_error",
                    "code": "invalid_api_key",
                }
            },
        )
    return credentials.credentials


def normalize_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
            elif isinstance(item, dict) and item.get("type") in {"input_text", "output_text"}:
                parts.append(item.get("text", ""))
        return " ".join(part for part in parts if part)
    if content is None:
        return ""
    return str(content)


def normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for message in messages:
        item = {
            "role": message.get("role", "user"),
            "content": normalize_content(message.get("content", "")),
        }
        if message.get("name"):
            item["name"] = message["name"]
        if message.get("tool_call_id"):
            item["tool_call_id"] = message["tool_call_id"]
        if message.get("tool_calls"):
            item["tool_calls"] = message["tool_calls"]
        normalized.append(item)
    return normalized


def normalize_responses_input(body: dict[str, Any]) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []

    instructions = body.get("instructions")
    if instructions:
        messages.append({"role": "system", "content": normalize_content(instructions)})

    input_data = body.get("input")
    if input_data is None and body.get("messages") is not None:
        input_data = body.get("messages")

    if isinstance(input_data, str):
        messages.append({"role": "user", "content": input_data})
    elif isinstance(input_data, list):
        for item in input_data:
            if isinstance(item, str):
                messages.append({"role": "user", "content": item})
                continue

            if not isinstance(item, dict):
                messages.append({"role": "user", "content": normalize_content(item)})
                continue

            item_type = item.get("type")

            if item.get("role") or item_type == "message":
                messages.extend(normalize_messages([item]))
                continue

            if item_type in {"input_text", "text"}:
                messages.append({"role": "user", "content": normalize_content(item.get("text") or item.get("content", ""))})
                continue

            if item_type == "function_call_output":
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": item.get("call_id") or item.get("tool_call_id") or "",
                        "content": normalize_content(item.get("output") or item.get("content", "")),
                    }
                )
                continue

            if item_type == "function_call":
                arguments = item.get("arguments")
                if isinstance(arguments, (dict, list)):
                    arguments_text = json.dumps(arguments, ensure_ascii=False)
                else:
                    arguments_text = normalize_content(arguments)

                messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": item.get("call_id") or item.get("id") or f"call_{uuid.uuid4().hex[:8]}",
                                "type": "function",
                                "function": {
                                    "name": item.get("name", ""),
                                    "arguments": arguments_text,
                                },
                            }
                        ],
                    }
                )
                continue

            messages.append(
                {
                    "role": item.get("role", "user"),
                    "content": normalize_content(item.get("content") or item.get("text") or ""),
                }
            )
    else:
        messages.append({"role": "user", "content": normalize_content(input_data)})

    return messages


def default_usage() -> dict[str, int]:
    return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


def merge_tool_calls(existing: list[dict[str, Any]], delta_calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = [json.loads(json.dumps(item)) for item in existing]

    for delta in delta_calls or []:
        index = delta.get("index", len(merged))
        while len(merged) <= index:
            merged.append({"id": None, "type": "function", "function": {"name": "", "arguments": ""}})

        current = merged[index]
        if delta.get("id"):
            current["id"] = delta["id"]
        if delta.get("type"):
            current["type"] = delta["type"]

        function_delta = delta.get("function") or {}
        function_current = current.setdefault("function", {"name": "", "arguments": ""})
        if function_delta.get("name"):
            function_current["name"] += function_delta["name"]
        if function_delta.get("arguments"):
            function_current["arguments"] += function_delta["arguments"]

    return merged


def build_openai_chat_response(msg_id: str, model: str, result: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{msg_id[:8]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result.get("content", ""),
                    "tool_calls": result.get("tool_calls") or None,
                },
                "finish_reason": result.get("finish_reason", "stop"),
            }
        ],
        "usage": result.get("usage", default_usage()),
    }


def build_openai_chat_chunk(msg_id: str, model: str, delta: dict[str, Any], finish_reason: Any = None) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{msg_id[:8]}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "delta": delta,
                "finish_reason": finish_reason,
            }
        ],
    }


def build_responses_object(msg_id: str, model: str, result: dict[str, Any]) -> dict[str, Any]:
    response_id = f"resp-{msg_id[:8]}"
    output: list[dict[str, Any]] = []

    content = result.get("content", "")
    if content:
        output.append(
            {
                "id": f"msg-{msg_id[:8]}",
                "type": "message",
                "role": "assistant",
                "status": "completed",
                "content": [{"type": "output_text", "text": content}],
            }
        )

    for index, tool_call in enumerate(result.get("tool_calls") or []):
        function_data = tool_call.get("function") or {}
        output.append(
            {
                "id": tool_call.get("id") or f"call-{msg_id[:8]}-{index}",
                "type": "function_call",
                "status": "completed",
                "call_id": tool_call.get("id") or f"call-{msg_id[:8]}-{index}",
                "name": function_data.get("name", ""),
                "arguments": function_data.get("arguments", ""),
                "index": index,
            }
        )

    return {
        "id": response_id,
        "object": "response",
        "created_at": int(time.time()),
        "model": model,
        "status": "completed",
        "output": output,
        "output_text": content,
        "usage": result.get("usage", default_usage()),
    }


def build_responses_created(msg_id: str, model: str) -> dict[str, Any]:
    return {
        "id": f"resp-{msg_id[:8]}",
        "object": "response",
        "created_at": int(time.time()),
        "model": model,
        "status": "in_progress",
    }


def sse_event(event: str, payload: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def response_message_id(msg_id: str) -> str:
    return f"msg-{msg_id[:8]}"


def response_call_id(msg_id: str, index: int) -> str:
    return f"call-{msg_id[:8]}-{index}"


async def submit_generate_job(mode: str, body: dict[str, Any], messages: list[dict[str, Any]], model: str) -> tuple[str, asyncio.Future]:
    if not ai_websocket:
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "message": "AI backend not connected.",
                    "type": "server_error",
                    "code": "backend_unavailable",
                }
            },
        )

    msg_id = str(uuid.uuid4())
    loop = asyncio.get_running_loop()
    future = loop.create_future()
    pending_requests[msg_id] = {
        "future": future,
        "queue": asyncio.Queue(),
        "mode": mode,
        "result": {"content": "", "tool_calls": [], "finish_reason": "stop", "usage": default_usage()},
        "model": model,
        "response_id": f"resp-{msg_id[:8]}",
    }

    payload = {
        "type": "generate",
        "id": msg_id,
        "messages": messages,
        "model": model,
        "stream": body.get("stream", False),
        "max_tokens": body.get(
            "max_tokens",
            body.get("max_completion_tokens", body.get("max_output_tokens", 4096)),
        ),
        "temperature": body.get("temperature", 0.7),
        "top_p": body.get("top_p", 0.9),
        "top_k": body.get("top_k", 40),
        "repetition_penalty": body.get("repetition_penalty", 1.1),
    }

    for key in ("tools", "tool_choice", "parallel_tool_calls", "response_format", "stop", "seed", "presence_penalty", "frequency_penalty"):
        if body.get(key) is not None:
            payload[key] = body[key]

    try:
        await ai_websocket.send_text(json.dumps(payload, ensure_ascii=False))
    except Exception:
        pending_requests.pop(msg_id, None)
        raise HTTPException(
            status_code=503,
            detail={
                "error": {
                    "message": "AI backend connection lost.",
                    "type": "server_error",
                    "code": "backend_unavailable",
                }
            },
        )

    return msg_id, future


@app.get("/v1/models")
async def list_models(key: str = Depends(verify_key)):
    now = int(time.time())
    return {
        "object": "list",
        "data": [
            {"id": CHAT_MODEL_ID, "object": "model", "created": now, "owned_by": "local"},
        ],
    }


@app.get("/v1/models/{model_id}")
async def get_model(model_id: str, key: str = Depends(verify_key)):
    return {"id": model_id, "object": "model", "created": int(time.time()), "owned_by": "local"}


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, key: str = Depends(verify_key)):
    body = await request.json()
    model = body.get("model", CHAT_MODEL_ID)
    stream = body.get("stream", False)
    messages = normalize_messages(body.get("messages", []))

    msg_id, future = await submit_generate_job("chat", body, messages, model)

    if stream:

        async def event_stream():
            created = int(time.time())
            chunk_id = f"chatcmpl-{msg_id[:8]}"
            req = pending_requests[msg_id]

            while True:
                item = await req["queue"].get()
                if item is None:
                    break

                if item["type"] == "chunk":
                    chunk = item["chunk"]
                    chunk["id"] = chunk.get("id", chunk_id)
                    chunk["created"] = chunk.get("created", created)
                    chunk["model"] = chunk.get("model", model)
                    yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"
                elif item["type"] == "done":
                    break

            yield "data: [DONE]\n\n"
            pending_requests.pop(msg_id, None)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        result = await asyncio.wait_for(future, timeout=300)
    except asyncio.TimeoutError:
        pending_requests.pop(msg_id, None)
        raise HTTPException(status_code=504, detail={"error": {"message": "Request timed out"}})

    pending_requests.pop(msg_id, None)
    return build_openai_chat_response(msg_id, model, result)


@app.post("/v1/responses")
async def responses(request: Request, key: str = Depends(verify_key)):
    body = await request.json()
    model = body.get("model", CHAT_MODEL_ID)
    stream = body.get("stream", False)
    messages = normalize_responses_input(body)

    msg_id, future = await submit_generate_job("responses", body, messages, model)

    if stream:

        async def event_stream():
            req = pending_requests[msg_id]
            response_id = req["response_id"]
            yield sse_event("response.created", build_responses_created(msg_id, model))

            while True:
                item = await req["queue"].get()
                if item is None:
                    break

                if item["type"] == "event":
                    yield sse_event(item["event"], item["data"])
                elif item["type"] == "done":
                    break

            final = build_responses_object(msg_id, model, req["result"])
            yield sse_event("response.completed", final)
            pending_requests.pop(msg_id, None)

        return StreamingResponse(
            event_stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    try:
        result = await asyncio.wait_for(future, timeout=300)
    except asyncio.TimeoutError:
        pending_requests.pop(msg_id, None)
        raise HTTPException(status_code=504, detail={"error": {"message": "Response request timed out"}})

    pending_requests.pop(msg_id, None)
    return build_responses_object(msg_id, model, result)


@app.websocket("/ai-connect")
async def ai_connect(websocket: WebSocket):
    global ai_websocket
    await websocket.accept()

    try:
        first = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        auth = json.loads(first)
        if auth.get("type") != "auth" or auth.get("token") != API_KEY:
            await websocket.close(code=4001, reason="bad auth")
            return
    except Exception:
        try:
            await websocket.close(code=4001, reason="auth failed")
        except Exception:
            pass
        return

    old = ai_websocket
    ai_websocket = websocket
    if old is not None:
        try:
            await old.close(code=4000, reason="replaced")
        except Exception:
            pass

    print("[AI] Colab connected")

    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            msg_type = msg.get("type")
            msg_id = msg.get("id")

            if msg_type == "chunk" and msg_id in pending_requests:
                req = pending_requests[msg_id]
                await req["queue"].put({"type": "chunk", "chunk": msg["chunk"]})

                choice = (msg["chunk"].get("choices") or [{}])[0]
                delta = choice.get("delta", {})
                if delta.get("content"):
                    req["result"]["content"] += delta["content"]
                if delta.get("tool_calls"):
                    req["result"]["tool_calls"] = merge_tool_calls(req["result"]["tool_calls"], delta["tool_calls"])
                if choice.get("finish_reason"):
                    req["result"]["finish_reason"] = choice["finish_reason"]

                if req["mode"] == "responses":
                    response_id = req["response_id"]
                    if delta.get("content"):
                        await req["queue"].put(
                            {
                                "type": "event",
                                "event": "response.output_text.delta",
                                "data": {
                                    "id": response_id,
                                    "object": "response",
                                    "model": req["model"],
                                    "output_index": 0,
                                    "item_id": response_message_id(msg_id),
                                    "delta": delta["content"],
                                },
                            }
                        )

                    for tool_delta in delta.get("tool_calls") or []:
                        index = tool_delta.get("index", 0)
                        function_delta = tool_delta.get("function") or {}
                        delta_payload = {}
                        if function_delta.get("name"):
                            delta_payload["name"] = function_delta["name"]
                        if function_delta.get("arguments"):
                            delta_payload["delta"] = function_delta["arguments"]

                        if delta_payload:
                            await req["queue"].put(
                                {
                                    "type": "event",
                                    "event": "response.function_call_arguments.delta",
                                    "data": {
                                        "id": response_id,
                                        "object": "response",
                                        "model": req["model"],
                                        "output_index": index,
                                        "item_id": tool_delta.get("id") or response_call_id(msg_id, index),
                                        **delta_payload,
                                    },
                                }
                            )

            elif msg_type == "done" and msg_id in pending_requests:
                req = pending_requests[msg_id]
                if req["mode"] in {"chat", "responses"}:
                    result = {
                        "content": msg.get("content", req["result"].get("content", "")),
                        "tool_calls": msg.get("tool_calls", req["result"].get("tool_calls", [])),
                        "finish_reason": msg.get("finish_reason", req["result"].get("finish_reason", "stop")),
                        "usage": msg.get("usage", default_usage()),
                    }
                    req["result"] = result
                    await req["queue"].put({"type": "done"})
                    if not req["future"].done():
                        req["future"].set_result(result)

    except WebSocketDisconnect:
        if ai_websocket is websocket:
            ai_websocket = None
            await flush_pending("AI disconnected")
    except Exception as error:
        if ai_websocket is websocket:
            ai_websocket = None
            print(f"[AI] Error: {error}")
            await flush_pending(f"AI error: {error}")


async def flush_pending(reason: str):
    for msg_id, req in list(pending_requests.items()):
        if req["mode"] in {"chat", "responses"}:
            await req["queue"].put({"type": "done"})
            if not req["future"].done():
                req["future"].set_result(
                    {
                        "content": req["result"].get("content") or f"[generation interrupted: {reason}]",
                        "tool_calls": req["result"].get("tool_calls", []),
                        "finish_reason": "stop",
                        "usage": default_usage(),
                    }
                )
        else:
            if not req["future"].done():
                req["future"].set_exception(RuntimeError(reason))
    pending_requests.clear()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "ai_connected": ai_websocket is not None,
        "chat_model": CHAT_MODEL_ID,
        "openai_compat": True,
    }


if __name__ == "__main__":
    print("=" * 60)
    print("Gemma OpenAI Relay Server")
    print(f"API KEY: {API_KEY}")
    print("URL:     http://0.0.0.0:8000")
    print(f"CHAT:    {CHAT_MODEL_ID}")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)
