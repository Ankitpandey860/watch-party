import { useCallback, useState } from "react";

export function useCopyToClipboard(timeout = 1500) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), timeout);
        return true;
      } catch {
        return false;
      }
    },
    [timeout],
  );
  return { copied, copy };
}