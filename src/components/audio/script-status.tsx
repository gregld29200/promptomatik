import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { t } from "@/lib/i18n";
import type { AudioMode } from "@/lib/api";
import { dialogueCast, type CastMember, type ScriptLintFinding } from "@/lib/audio-script-rules";
import s from "./script-status.module.css";

interface ScriptStatusProps {
  mode: AudioMode;
  script: string;
  findings: ScriptLintFinding[];
  cast: CastMember[];
  estimate: string;
  onSwitchToDialogue: () => void;
}

function joinNames(names: string[]): string {
  return names.join(", ");
}

// Text in parentheses is read aloud by the voice: worth one calm reminder.
export function countParentheses(script: string): number {
  return script.match(/\([^)\n]*\)/g)?.length ?? 0;
}

// One line under the editor that says where the script stands: who speaks
// and how long it lasts, or the single thing to fix — never a list per line.
export function ScriptStatus({ mode, script, findings, cast, estimate, onSwitchToDialogue }: ScriptStatusProps) {
  if (!script.trim()) return null;

  const blocking = findings.filter((finding) => finding.severity === "blocking" && finding.code !== "empty_script");
  const problems: Array<{ key: string; text: string; action?: { label: string; onClick: () => void } }> = [];
  const seen = new Set<string>();
  for (const finding of blocking) {
    if (seen.has(finding.code)) continue;
    seen.add(finding.code);
    if (finding.code === "speaker_label_in_monologue") {
      problems.push({
        key: finding.code,
        text: t("audio.status_monologue_names", { names: joinNames(dialogueCast(script).map((member) => member.label)) }),
        action: { label: t("audio.switch_to_dialogue"), onClick: onSwitchToDialogue },
      });
    } else if (finding.code === "too_many_speakers") {
      const names = finding.names ?? [];
      problems.push({ key: finding.code, text: t("audio.status_too_many", { count: String(names.length), names: joinNames(names) }) });
    } else if (finding.code === "orphan_line") {
      problems.push({ key: finding.code, text: t("audio.status_orphan", { line: String(finding.line ?? 1) }) });
    } else if (finding.code === "unbalanced_brackets") {
      problems.push({ key: finding.code, text: t("audio.status_brackets") });
    } else {
      problems.push({ key: finding.code, text: t(`audio.lint_${finding.code}`) });
    }
  }

  const parentheses = countParentheses(script);
  const castLine = mode === "dialogue"
    ? t(cast.length === 1 ? "audio.status_cast_one" : "audio.status_cast_many", {
      count: String(cast.length),
      names: joinNames(cast.map((member) => member.label)),
    })
    : t("audio.status_monologue");

  return (
    // Only a problem is announced: the cast and duration change with every
    // keystroke and would otherwise talk over the teacher's typing.
    <div className={s.status}>
      {problems.length > 0 ? (
        problems.map((problem) => (
          <p key={problem.key} className={s.problem} role="alert">
            <AlertCircle size={16} aria-hidden />
            <span>{problem.text}</span>
            {problem.action && (
              <button type="button" className={s.action} onClick={problem.action.onClick}>
                {problem.action.label}
              </button>
            )}
          </p>
        ))
      ) : (
        <p className={s.ready}>
          <CheckCircle2 size={16} aria-hidden />
          <span>{mode === "dialogue" && cast.length === 0 ? t("audio.status_no_cast") : castLine}</span>
          <span className={s.estimate}>{estimate}</span>
        </p>
      )}
      {parentheses > 0 && problems.length === 0 && (
        <p className={s.info}>
          <Info size={16} aria-hidden />
          <span>
            {t(parentheses === 1 ? "audio.status_parentheses_one" : "audio.status_parentheses_many", { count: String(parentheses) })}
          </span>
        </p>
      )}
    </div>
  );
}
