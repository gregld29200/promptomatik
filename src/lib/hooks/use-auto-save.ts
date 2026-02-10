import { useRef, useEffect, useState, useCallback } from "react";
import * as api from "@/lib/api";
import type { PromptBlock } from "@/lib/api";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutoSave(promptId: string, blocks: PromptBlock[]) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blocksRef = useRef(blocks);
  const initialRef = useRef(true);

  // Track latest blocks
  blocksRef.current = blocks;

  const save = useCallback(async () => {
    setStatus("saving");
    const result = await api.updatePrompt(promptId, {
      blocks: blocksRef.current,
    });
    if (result.error) {
      setStatus("error");
    } else {
      setStatus("saved");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }, [promptId]);

  useEffect(() => {
    // Skip the initial render
    if (initialRef.current) {
      initialRef.current = false;
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(save, 800);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [blocks, save]);

  return status;
}
