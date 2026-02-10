import { useState, useCallback } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for mobile / older browsers
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <Button
      variant="secondary"
      size="small"
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <>
          <Check size={14} /> {t("prompt.copied")}
        </>
      ) : (
        <>
          <Copy size={14} /> {t("prompt.copy_prompt")}
        </>
      )}
    </Button>
  );
}
