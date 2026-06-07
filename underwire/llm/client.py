"""
LLM client wrapping the Anthropic SDK.

Models per spec:
  SAR narratives  : claude-sonnet-4-6
  Updater + Agent0: claude-haiku-4-5-20251001

Never sends raw transactions — only compact JSON summaries.
Prompt caching on the static system block.
Retry with exponential backoff (SDK handles 429/5xx natively).
"""
from __future__ import annotations

import json
import os
import time
import random

import anthropic

_DEFAULT_SONNET  = "claude-sonnet-4-6"
_DEFAULT_HAIKU   = "claude-haiku-4-5-20251001"

_SYSTEM_SAR = (
    "You are a financial crime compliance officer writing Suspicious Activity Reports (SARs). "
    "You write ONLY from facts given to you in the input JSON. "
    "You introduce NO number that is not present in the input. "
    "You never speculate about intent. Your reports are concise, professional, and actionable."
)

_SYSTEM_ANALYST = (
    "You are a senior financial crime analyst assistant. "
    "You respond only with valid JSON as instructed. "
    "You base every observation strictly on the input data provided."
)


class LLMClient:
    def __init__(self, api_key: str | None = None):
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    def complete(
        self,
        system: str,
        user: str,
        model: str = _DEFAULT_HAIKU,
        json_mode: bool = False,
        max_tokens: int = 512,
        max_retries: int = 3,
    ) -> str | dict:
        """
        Single completion with prompt caching on the system block.
        Returns raw text, or parsed dict when json_mode=True.
        """
        system_block = [
            {
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }
        ]

        messages = [{"role": "user", "content": user}]

        last_exc = None
        for attempt in range(max_retries):
            try:
                resp = self._client.messages.create(
                    model=model,
                    max_tokens=max_tokens,
                    system=system_block,
                    messages=messages,
                )
                text = next(
                    (b.text for b in resp.content if b.type == "text"), ""
                )
                if json_mode:
                    # Strip markdown fences if present
                    stripped = text.strip()
                    if stripped.startswith("```"):
                        lines = stripped.split("\n")
                        stripped = "\n".join(lines[1:-1])
                    return json.loads(stripped)
                return text
            except anthropic.RateLimitError as e:
                last_exc = e
                wait = min(2 ** attempt + random.uniform(0, 1), 30)
                time.sleep(wait)
            except anthropic.APIStatusError as e:
                if e.status_code >= 500:
                    last_exc = e
                    time.sleep(2 ** attempt)
                else:
                    raise

        raise last_exc

    def sar_narrative(self, finding_json: dict, max_tokens: int = 800) -> str:
        user_prompt = (
            "Write a 5-sentence suspicious-activity report for a compliance officer using ONLY "
            "the figures provided in the JSON below. Introduce NO number not present in the input. "
            "End with the recommended action.\n\n"
            f"Input:\n{json.dumps(finding_json, indent=2)}"
        )
        return self.complete(
            system=_SYSTEM_SAR,
            user=user_prompt,
            model=_DEFAULT_SONNET,
            json_mode=False,
            max_tokens=max_tokens,
        )

    def name_pattern(self, feature_signature: dict) -> dict:
        user_prompt = (
            "Return ONLY valid JSON with keys: pattern_name, one_line_rule, why.\n\n"
            f"Feature signature:\n{json.dumps(feature_signature, indent=2)}"
        )
        result = self.complete(
            system=_SYSTEM_ANALYST,
            user=user_prompt,
            model=_DEFAULT_HAIKU,
            json_mode=True,
            max_tokens=300,
        )
        return result if isinstance(result, dict) else {}

    def diagnose_rejects(self, payload: dict) -> dict:
        user_prompt = (
            "Analyse the rejected alerts and current detector config below. "
            "Return ONLY valid JSON with keys: param (str), value (the new value), reason (str). "
            "Propose ONE config change that would reduce false positives while keeping true positives. "
            "Keep the change magnitude small.\n\n"
            f"{json.dumps(payload, indent=2)}"
        )
        result = self.complete(
            system=_SYSTEM_ANALYST,
            user=user_prompt,
            model=_DEFAULT_HAIKU,
            json_mode=True,
            max_tokens=300,
        )
        return result if isinstance(result, dict) else {}
