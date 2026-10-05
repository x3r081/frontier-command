"""Create one game asset through Meshy's Image to 3D API.

Usage: python3 scripts/meshy_asset.py INPUT.png OUTPUT.glb
The key is read from MESHY_API_KEY or a hidden terminal prompt; it is never saved.
"""

import base64
import getpass
import json
import os
from pathlib import Path
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "https://api.meshy.ai/openapi/v1/image-to-3d"


def request(url, key, payload=None):
    headers = {"Authorization": f"Bearer {key}"}
    if payload is not None:
        headers["Content-Type"] = "application/json"
    data = json.dumps(payload).encode() if payload is not None else None
    req = Request(url, data=data, headers=headers, method="POST" if data else "GET")
    try:
        with urlopen(req, timeout=120) as response:
            raw = response.read()
            return json.loads(raw), response.headers
    except HTTPError as exc:
        # Do not print request bodies, response URLs, or authorization headers.
        try:
            detail = json.loads(exc.read().decode()).get("message", "")
        except (ValueError, UnicodeError):
            detail = ""
        if not isinstance(detail, str):
            detail = ""
        detail = detail.replace(key, "[redacted]")[:400]
        raise RuntimeError(f"Meshy API returned HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise RuntimeError(f"Meshy API network error: {exc.reason}") from exc


def main():
    if len(sys.argv) != 3:
        raise SystemExit("Usage: meshy_asset.py INPUT.png OUTPUT.glb")
    source, output = map(Path, sys.argv[1:])
    key = os.environ.get("MESHY_API_KEY") or getpass.getpass("Meshy API key: ")
    if not key:
        raise SystemExit("A Meshy API key is required.")
    mime = "image/png" if source.suffix.lower() == ".png" else "image/jpeg"
    image_uri = f"data:{mime};base64,{base64.b64encode(source.read_bytes()).decode()}"
    task, _ = request(API, key, {
        "image_url": image_uri,
        "model_type": "smart-topology",
        "ai_model": "meshy-t2",
        "target_polycount": 5000,
        "should_texture": True,
        "texture_resolution": "2k",
        "target_formats": ["glb"],
    })
    task_id = task["result"]
    print(f"Meshy task created: {task_id}", flush=True)
    while True:
        status, headers = request(f"{API}/{task_id}", key)
        state = status.get("status", "UNKNOWN")
        print(f"Meshy status: {state} ({status.get('progress', 0)}%)", flush=True)
        if state == "SUCCEEDED":
            break
        if state in {"FAILED", "CANCELED"}:
            raise RuntimeError(f"Meshy task ended: {state}; {status.get('task_error', {}).get('message', '')}")
        time.sleep(max(5, min(25, int(headers.get("Retry-After", 8)))))
    model_url = status["model_urls"]["glb"]
    output.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(model_url, timeout=120) as response, output.open("wb") as handle:
        while chunk := response.read(1024 * 1024):
            handle.write(chunk)
    print(f"Saved {output} ({output.stat().st_size} bytes)", flush=True)


if __name__ == "__main__":
    main()
