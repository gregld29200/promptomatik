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
import {
  ONBOARDING_TOURS,
  type OnboardingStep,
  type OnboardingTourId,
} from "./steps";

type StartReason = "auto" | "manual";

type OnboardingState = {
  active: boolean;
  tourId: OnboardingTourId | null;
  stepIndex: number;
  reason: StartReason | null;
};

type OnboardingContextValue = {
  state: OnboardingState;
  step: OnboardingStep | null;
  steps: OnboardingStep[];
  start: (tourId: OnboardingTourId, reason: StartReason) => void;
  stop: () => void;
  next: () => void;
  back: () => void;
  complete: () => Promise<void>;
  maybeAutoStartMain: (args: { promptsCount: number; profile: TeacherProfile | null }) => void;
  maybeAutoStartProfile: (args: { profile: TeacherProfile | null }) => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OnboardingState>({
    active: false,
    tourId: null,
    stepIndex: 0,
    reason: null,
  });

  const steps = state.tourId ? ONBOARDING_TOURS[state.tourId].steps : [];

  const step = useMemo(() => {
    if (!state.active) return null;
    return steps[state.stepIndex] ?? null;
  }, [state.active, state.stepIndex, steps]);

  const start = useCallback((tourId: OnboardingTourId, reason: StartReason) => {
    setState({ active: true, tourId, stepIndex: 0, reason });
  }, []);

  const stop = useCallback(() => {
    setState((prev) => ({ ...prev, active: false, reason: null, tourId: null }));
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
    if (!state.tourId) return;
    const tour = ONBOARDING_TOURS[state.tourId];
    if (state.tourId === "main") {
      await api.updateProfile({
        onboarding_completed: true,
        onboarding_version: tour.version,
      });
    } else if (state.tourId === "profile") {
      await api.updateProfile({
        profile_onboarding_completed: true,
        profile_onboarding_version: tour.version,
      });
    }
    setState({ active: false, tourId: null, stepIndex: 0, reason: null });
  }, [state.tourId]);

  const maybeAutoStartMain = useCallback(
    ({ promptsCount, profile }: { promptsCount: number; profile: TeacherProfile | null }) => {
      if (!profile) return;
      if (state.active) return;
      if (promptsCount !== 0) return; // "2"
      if (profile.onboarding_completed) return; // "1"
      start("main", "auto");
    },
    [start, state.active]
  );

  const maybeAutoStartProfile = useCallback(
    ({ profile }: { profile: TeacherProfile | null }) => {
      if (!profile) return;
      if (state.active) return;
      if (profile.setup_completed) return;
      if (profile.profile_onboarding_completed) return;
      start("profile", "auto");
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
      maybeAutoStartMain,
      maybeAutoStartProfile,
    }),
    [state, step, steps, start, stop, next, back, complete, maybeAutoStartMain, maybeAutoStartProfile]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
