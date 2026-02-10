import type { ReactNode } from "react";
import s from "./badge.module.css";

type Technique =
  | "role"
  | "context"
  | "examples"
  | "constraints"
  | "steps"
  | "think_first";

interface BadgeProps {
  technique?: Technique;
  className?: string;
  children: ReactNode;
}

const techniqueClassMap: Record<Technique, string> = {
  role: s.role,
  context: s.context,
  examples: s.examples,
  constraints: s.constraints,
  steps: s.steps,
  think_first: s.thinkFirst,
};

export function Badge({ technique, className, children }: BadgeProps) {
  const variantClass = technique
    ? techniqueClassMap[technique]
    : s.default;
  const classes = [s.badge, variantClass, className].filter(Boolean).join(" ");

  return <span className={classes}>{children}</span>;
}
