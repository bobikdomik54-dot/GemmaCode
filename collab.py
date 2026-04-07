import asyncio
import json
import os
import queue
import subprocess
import sys
import threading
import time
import traceback
from typing import Any

import aiohttp
import nest_asyncio
import requests
import websockets

nest_asyncio.apply()

SERVER_IP = os.environ.get("SERVER_IP", "79.76.35.116")
SERVER_PORT = int(os.environ.get("SERVER_PORT", "8000"))
SERVER_WS = os.environ.get("SERVER_WS", f"ws://{SERVER_IP}:{SERVER_PORT}/ai-connect")
SERVER_API_KEY = os.environ.get("SERVER_API_KEY", "sk-gemma4code-relay-key-2025")
KOBOLD_URL = os.environ.get("KOBOLD_URL", "http://localhost:5001/v1/chat/completions")
KOBOLD_MODEL = os.environ.get("KOBOLD_MODEL", "koboldcpp")

job_queue = queue.Queue()
result_queue = queue.Queue()
cancel_event = threading.Event()
proc = None


def start_kobold():
    global proc

    if os.environ.get("SKIP_KOBOLD_START") == "1":
        print("[INFO] SKIP_KOBOLD_START=1, using existing backend")
        return

    print("[INFO] Starting KoboldCpp...")
    proc = subprocess.Popen(
        [
            "./koboldcpp-linux-x64",
            "--model",
            os.environ.get("KOBOLD_GGUF_PATH", "/content/Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M.gguf"),
            "--port",
            "5001",
            "--gpu-layers",
            os.environ.get("KOBOLD_GPU_LAYERS", "999"),
            "--usecuda",
            "mmq",
            "--batchsize",
            os.environ.get("KOBOLD_BATCHSIZE", "4096"),
            "--contextsize",
            os.environ.get("KOBOLD_CONTEXTSIZE", "120000"),
            "--threads",
            os.environ.get("KOBOLD_THREADS", "1"),
            "--blasthreads",
            os.environ.get("KOBOLD_BLASTHREADS", "1"),
            "--flashattention",
            "--highpriority",
            "--quantkv",
            os.environ.get("KOBOLD_QUANTKV", "2"),
            "--maingpu",
            os.environ.get("KOBOLD_MAINGPU", "0"),
            "--jinja",
            "--jinjatools",
            "--useswa",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env={
            **os.environ,
            "CUDA_VISIBLE_DEVICES": os.environ.get("CUDA_VISIBLE_DEVICES", "0"),
            "GGML_CUDA_NO_PINNED": "1",
            "GGML_CUDA_FORCE_MMQ": "1",
            "GGML_CUDA_MMQ_Y": "1",
            "GGML_CUDA_DMMV_X": "64",
            "CUDA_LAUNCH_BLOCKING": "0",
        },
    )

    print("[INFO] Waiting for KoboldCpp startup...")
    for line in proc.stdout:
        if any(token in line for token in ("Load Text Model", "Starting OpenAI", "ERROR", "CUDA0")):
            print(f"[KOBOLD] {line.rstrip()}")
        if "Starting OpenAI Compatible API" in line:
            print("[INFO] KoboldCpp is ready")
            time.sleep(2)
            break
        if proc.poll() is not None:
            print("[ERROR] KoboldCpp exited during startup")
            sys.exit(1)

    threading.Thread(
        target=lambda process: [print(f"[KOBOLD] {line.rstrip()}") for line in process.stdout if "error" in line.lower()],
        args=(proc,),
        daemon=True,
    ).start()

    for attempt in range(20):
        try:
            response = requests.get("http://localhost:5001/api/v1/model", timeout=5)
            if response.status_code == 200:
                print(f"[INFO] Backend model: {response.json().get('result', '')}")
                break
        except Exception:
            print(f"[INFO] Waiting for API {attempt + 1}/20...")
            time.sleep(2)

    try:
        requests.post(
            KOBOLD_URL,
            json={
                "model": KOBOLD_MODEL,
                "messages": [{"role": "user", "content": "hi"}],
                "max_tokens": 3,
                "stream": False,
            },
            timeout=30,
        )
        print("[INFO] Warmup complete")
    except Exception as error:
        print(f"[WARN] Warmup failed: {error}")


def normalize_text_content(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict) and item.get("type") == "text":
                parts.append(item.get("text", ""))
        return " ".join(parts)
    return str(content or "")


def normalize_messages(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized = []
    for message in messages:
        item = {
            "role": message.get("role", "user"),
            "content": normalize_text_content(message.get("content", "")),
        }
        if message.get("name"):
            item["name"] = message["name"]
        if message.get("tool_call_id"):
            item["tool_call_id"] = message["tool_call_id"]
        if message.get("tool_calls"):
            item["tool_calls"] = message["tool_calls"]
        normalized.append(item)
    return normalized


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


def build_openai_chunk(msg_id: str, model: str, delta: dict[str, Any], finish_reason: Any = None) -> dict[str, Any]:
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


def ai_worker_thread():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(ai_worker_loop())


async def ai_worker_loop():
    timeout = aiohttp.ClientTimeout(total=600)
    session = aiohttp.ClientSession(timeout=timeout)
    print("[AI-WORKER] Started")

    while True:
        try:
            job = await asyncio.get_event_loop().run_in_executor(None, job_queue.get)
        except Exception:
            break

        if job is None:
            break

        try:
            if job.get("type") == "generate":
                await handle_generate_job(session, job)
        except Exception as error:
            traceback.print_exc()
            if job.get("type") == "generate":
                result_queue.put(
                    {
                        "type": "done",
                        "id": job["id"],
                        "content": "",
                        "tool_calls": [],
                        "finish_reason": "stop",
                        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                        "epoch": job["epoch"],
                        "error": str(error),
                    }
                )

    await session.close()
    print("[AI-WORKER] Stopped")


async def handle_generate_job(session: aiohttp.ClientSession, job: dict[str, Any]):
    msg_id = job["id"]
    epoch = job["epoch"]
    model = job.get("model", KOBOLD_MODEL)
    messages = normalize_messages(job.get("messages", []))

    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "max_tokens": job.get("max_tokens", 4096),
        "temperature": job.get("temperature", 0.2),
        "top_p": job.get("top_p", 0.95),
        "top_k": job.get("top_k", 40),
        "repetition_penalty": job.get("repetition_penalty", 1.05),
    }
    if job.get("tools") is not None:
        payload["tools"] = job["tools"]
    if job.get("tool_choice") is not None:
        payload["tool_choice"] = job["tool_choice"]

    print(f"[AI] generate {msg_id[:8]} messages={len(messages)} tools={len(payload.get('tools') or [])}")

    full_content = ""
    merged_tool_calls = []
    finish_reason = "stop"
    usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    async with session.post(KOBOLD_URL, json=payload) as response:
        response.raise_for_status()
        buffer = b""

        async for chunk_bytes in response.content.iter_any():
            if cancel_event.is_set():
                print(f"[AI] Cancelled job {msg_id[:8]}")
                break

            buffer += chunk_bytes
            while b"\n" in buffer:
                raw_line, buffer = buffer.split(b"\n", 1)
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line or not line.startswith("data: "):
                    continue

                data_str = line[6:]
                if data_str == "[DONE]":
                    break

                parsed = json.loads(data_str)
                choice = (parsed.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                finish_reason = choice.get("finish_reason") or finish_reason
                usage = parsed.get("usage") or usage

                if delta.get("content"):
                    full_content += delta["content"]
                if delta.get("tool_calls"):
                    merged_tool_calls = merge_tool_calls(merged_tool_calls, delta["tool_calls"])

                result_queue.put(
                    {
                        "type": "chunk",
                        "id": msg_id,
                        "chunk": build_openai_chunk(msg_id, model, delta, choice.get("finish_reason")),
                        "epoch": epoch,
                    }
                )

    result_queue.put(
        {
            "type": "done",
            "id": msg_id,
            "content": full_content,
            "tool_calls": merged_tool_calls,
            "finish_reason": finish_reason,
            "usage": usage,
            "epoch": epoch,
        }
    )


_ws_ref = None
_alive = False
_conn_epoch = 0
_send_queue = None


async def sender_loop():
    while True:
        payload = await _send_queue.get()
        if payload is None:
            break
        if not _alive or _ws_ref is None:
            continue
        await _ws_ref.send(json.dumps(payload, ensure_ascii=False))


async def heartbeat(ws):
    try:
        while True:
            await asyncio.sleep(25)
            await ws.send(json.dumps({"type": "pong"}))
    except Exception:
        return


async def result_reader():
    loop = asyncio.get_event_loop()
    while _alive:
        try:
            item = await loop.run_in_executor(None, lambda: result_queue.get(timeout=0.1))
        except queue.Empty:
            continue
        except Exception:
            break

        if item.get("epoch") == _conn_epoch and _send_queue is not None:
            outbound = {key: value for key, value in item.items() if key != "epoch"}
            _send_queue.put_nowait(outbound)


async def network_main():
    global _alive, _conn_epoch, _send_queue, _ws_ref

    retry = 0
    print(f"[NET] Connecting to {SERVER_WS}")

    while True:
        if retry:
            delay = min(2 ** min(retry, 6), 60)
            print(f"[NET] Reconnecting in {delay}s")
            await asyncio.sleep(delay)

        sender_task = None
        heartbeat_task = None
        reader_task = None

        try:
            async with websockets.connect(
                SERVER_WS,
                ping_interval=20,
                ping_timeout=30,
                close_timeout=10,
                max_size=50 * 1024 * 1024,
            ) as ws:
                await ws.send(json.dumps({"type": "auth", "token": SERVER_API_KEY}))

                cancel_event.set()
                time.sleep(0.05)
                cancel_event.clear()

                while not result_queue.empty():
                    try:
                        result_queue.get_nowait()
                    except Exception:
                        break

                _conn_epoch += 1
                _alive = True
                _ws_ref = ws
                _send_queue = asyncio.Queue()
                retry = 0
                epoch = _conn_epoch

                print(f"[NET] Connected (epoch={epoch})")

                sender_task = asyncio.create_task(sender_loop())
                heartbeat_task = asyncio.create_task(heartbeat(ws))
                reader_task = asyncio.create_task(result_reader())

                async for raw_message in ws:
                    try:
                        msg = json.loads(raw_message)
                    except json.JSONDecodeError:
                        continue

                    msg_type = msg.get("type")
                    if msg_type == "generate":
                        job = dict(msg)
                        job["epoch"] = epoch
                        job_queue.put(job)
                        print(f"[NET] queued {msg_type} {job.get('id', '')[:8]}")
                    elif msg_type == "ping":
                        _send_queue.put_nowait({"type": "pong"})

        except websockets.exceptions.ConnectionClosedError as error:
            if error.rcvd and error.rcvd.code == 4000:
                print("[NET] Replaced by a newer instance, stopping")
                return
            print(f"[NET] Closed: {error}")
            retry += 1
        except Exception as error:
            if "4000" in str(error):
                print("[NET] Replaced by a newer instance, stopping")
                return
            print(f"[NET] Disconnected: {error}")
            retry += 1
        finally:
            _alive = False
            _ws_ref = None
            cancel_event.set()

            if heartbeat_task:
                heartbeat_task.cancel()
            if reader_task:
                reader_task.cancel()
            if sender_task and _send_queue is not None:
                _send_queue.put_nowait(None)
                try:
                    await asyncio.wait_for(sender_task, timeout=2)
                except Exception:
                    pass


def main():
    start_kobold()

    print("=" * 60)
    print("Gemma Colab Worker")
    print("  [main] websocket transport")
    print("  [worker] generation")
    print("=" * 60)

    ai_thread = threading.Thread(target=ai_worker_thread, daemon=True, name="ai-worker")
    ai_thread.start()

    try:
        asyncio.get_event_loop().run_until_complete(network_main())
    except KeyboardInterrupt:
        print("\n[INFO] Shutting down")
    finally:
        cancel_event.set()
        job_queue.put(None)
        if proc is not None:
            proc.kill()


if __name__ == "__main__":
    main()
