export type OnboardingTourId = "main" | "profile";

export type OnboardingStep = {
  id: string;
  route: string;
  selector: string;
  titleKey: string;
  bodyKey: string;
  advanceOn?: "click" | "next";
};

export const MAIN_ONBOARDING_VERSION = 1;
export const PROFILE_ONBOARDING_VERSION = 1;

export const ONBOARDING_TOURS: Record<
  OnboardingTourId,
  { version: number; steps: OnboardingStep[] }
> = {
  main: {
    version: MAIN_ONBOARDING_VERSION,
    steps: [
      {
        id: "dashboard_new_prompt",
        route: "/dashboard",
        selector: "[data-onboard='new-prompt']",
        titleKey: "onboarding.dashboard_new_prompt.title",
        bodyKey: "onboarding.dashboard_new_prompt.body",
        advanceOn: "click",
      },
      {
        id: "new_request_text",
        route: "/new",
        selector: "[data-onboard='request-text']",
        titleKey: "onboarding.new_request_text.title",
        bodyKey: "onboarding.new_request_text.body",
        advanceOn: "next",
      },
      {
        id: "new_submit_request",
        route: "/new",
        selector: "[data-onboard='submit-request']",
        titleKey: "onboarding.new_submit_request.title",
        bodyKey: "onboarding.new_submit_request.body",
        advanceOn: "click",
      },
      {
        id: "questions_pick",
        route: "/new",
        selector: "[data-onboard='question-card']",
        titleKey: "onboarding.questions_pick.title",
        bodyKey: "onboarding.questions_pick.body",
        advanceOn: "next",
      },
      {
        id: "done_save",
        route: "/new",
        selector: "[data-onboard='save-prompt']",
        titleKey: "onboarding.done_save.title",
        bodyKey: "onboarding.done_save.body",
        advanceOn: "click",
      },
    ],
  },

  profile: {
    version: PROFILE_ONBOARDING_VERSION,
    steps: [
      {
        id: "profile_languages",
        route: "/profile",
        selector: "[data-onboard='profile-languages']",
        titleKey: "onboarding.profile.languages.title",
        bodyKey: "onboarding.profile.languages.body",
        advanceOn: "next",
      },
      {
        id: "profile_levels",
        route: "/profile",
        selector: "[data-onboard='profile-levels']",
        titleKey: "onboarding.profile.levels.title",
        bodyKey: "onboarding.profile.levels.body",
        advanceOn: "next",
      },
      {
        id: "profile_audience",
        route: "/profile",
        selector: "[data-onboard='profile-audience']",
        titleKey: "onboarding.profile.audience.title",
        bodyKey: "onboarding.profile.audience.body",
        advanceOn: "next",
      },
      {
        id: "profile_duration",
        route: "/profile",
        selector: "[data-onboard='profile-duration']",
        titleKey: "onboarding.profile.duration.title",
        bodyKey: "onboarding.profile.duration.body",
        advanceOn: "next",
      },
      {
        id: "profile_context",
        route: "/profile",
        selector: "[data-onboard='profile-context']",
        titleKey: "onboarding.profile.context.title",
        bodyKey: "onboarding.profile.context.body",
        advanceOn: "next",
      },
      {
        id: "profile_save",
        route: "/profile",
        selector: "[data-onboard='profile-save']",
        titleKey: "onboarding.profile.save.title",
        bodyKey: "onboarding.profile.save.body",
        advanceOn: "click",
      },
    ],
  },
};

