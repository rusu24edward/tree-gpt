import os
from typing import List, Dict, Iterator
from openai import OpenAI

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT", "You are a helpful assistant.")

client = None
if OPENAI_API_KEY:
    client = OpenAI(api_key=OPENAI_API_KEY)

def build_messages(path_msgs: List[Dict]) -> List[Dict]:
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for m in path_msgs:
        role = m.get("role", "user")
        content = m.get("content", "")
        messages.append({"role": role, "content": content})
    return messages

def complete(messages: List[Dict]) -> str:
    if not client:
        # Mock response for dev without API key
        return "[MOCK RESPONSE] I understood your request and this is a placeholder reply because OPENAI_API_KEY is not set."
    resp = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
    )
    return resp.choices[0].message.content


def stream_complete(messages: List[Dict]) -> Iterator[str]:
    if not client:
        mock_reply = (
            "[MOCK RESPONSE] I understood your request and this is a placeholder reply because "
            "OPENAI_API_KEY is not set."
        )
        for token in mock_reply.split(" "):
            yield token + " "
        return

    stream = client.chat.completions.create(
        model=OPENAI_MODEL,
        messages=messages,
        stream=True,
    )
    for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
