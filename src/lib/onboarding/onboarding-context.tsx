import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import type { TeacherProfile } from "@/lib/api";
import { ONBOARDING_STEPS, ONBOARDING_VERSION, type OnboardingStep } from "./steps";

type StartReason = "auto" | "manual";

type OnboardingState = {
  active: boolean;
  stepIndex: number;
  reason: StartReason | null;
};

type OnboardingContextValue = {
  state: OnboardingState;
  step: OnboardingStep | null;
  steps: OnboardingStep[];
  start: (reason: StartReason) => void;
  stop: () => void;
  next: () => void;
  back: () => void;
  complete: () => Promise<void>;
  maybeAutoStart: (args: { promptsCount: number; profile: TeacherProfile | null }) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>({
    active: false,
    stepIndex: 0,
    reason: null,
  });

  const steps = ONBOARDING_STEPS;

  const step = useMemo(() => {
    if (!state.active) return null;
    return steps[state.stepIndex] ?? null;
  }, [state.active, state.stepIndex, steps]);

  const start = useCallback((reason: StartReason) => {
    setState({ active: true, stepIndex: 0, reason });
  }, []);

  const stop = useCallback(() => {
    setState((prev) => ({ ...prev, active: false, reason: null }));
  }, []);

  const next = useCallback(() => {
    setState((prev) => {
      const nextIndex = Math.min(prev.stepIndex + 1, steps.length - 1);
      return { ...prev, stepIndex: nextIndex };
    });
  }, [steps.length]);

  const back = useCallback(() => {
    setState((prev) => {
      const nextIndex = Math.max(prev.stepIndex - 1, 0);
      return { ...prev, stepIndex: nextIndex };
    });
  }, []);

  const complete = useCallback(async () => {
    await api.updateProfile({
      onboarding_completed: true,
      onboarding_version: ONBOARDING_VERSION,
    });
    setState({ active: false, stepIndex: 0, reason: null });
  }, []);

  const maybeAutoStart = useCallback(
    ({ promptsCount, profile }: { promptsCount: number; profile: TeacherProfile | null }) => {
      if (!profile) return;
      if (state.active) return;
      if (promptsCount !== 0) return; // "2"
      if (profile.onboarding_completed) return; // "1"
      start("auto");
    },
    [start, state.active]
  );

  const value = useMemo<OnboardingContextValue>(
    () => ({
      state,
      step,
      steps,
      start,
      stop,
      next,
      back,
      complete,
      maybeAutoStart,
    }),
    [state, step, steps, start, stop, next, back, complete, maybeAutoStart]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}

