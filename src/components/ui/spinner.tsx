import s from "./spinner.module.css";

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 20, className }: SpinnerProps) {
  const classes = [s.spinner, className].filter(Boolean).join(" ");

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={classes}
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="var(--color-cream-400)"
        strokeWidth="2.5"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="var(--color-navy-700)"
        strokeWidth="2.5"
        strokeLinecap="square"
      />
    </svg>
  );
}
