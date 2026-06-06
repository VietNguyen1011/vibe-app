# FastAPI app. Secrets from env. LLM via AI Gateway only (never boto3/Bedrock directly).
import os
import json
import urllib.request

from fastapi import FastAPI

app = FastAPI()


@app.get("/api/hello")
def hello():
    return {"message": "Hello from your VibeApp API", "model": os.environ.get("VIBEAPP_DEFAULT_MODEL", "unset")}


def ask(prompt: str):
    req = urllib.request.Request(
        f"{os.environ['VIBEAPP_GATEWAY_URL']}/v1/messages",
        data=json.dumps({
            "model": os.environ["VIBEAPP_DEFAULT_MODEL"],
            "messages": [{"role": "user", "content": prompt}],
        }).encode(),
        headers={
            "content-type": "application/json",
            "authorization": f"Bearer {os.environ['VIBEAPP_GATEWAY_TOKEN']}",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)
