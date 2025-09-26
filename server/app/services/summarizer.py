from typing import List, Dict

# Simple placeholder; in production you can call the LLM to summarize early context.
def maybe_summarize(path_msgs: List[Dict], max_keep: int = 20) -> List[Dict]:
    if len(path_msgs) <= max_keep:
        return path_msgs
    # Keep the most recent (max_keep - 1) and replace the earliest chunk by a short synthetic summary
    early = path_msgs[:- (max_keep - 1)]
    recent = path_msgs[- (max_keep - 1):]
    summary_text = "\n".join([f"- {m['role']}: {m['content'][:120]}..." for m in early])
    synthetic = {"role": "system", "content": f"Previous context (summarized):\n{summary_text}"}
    return [synthetic] + recent
