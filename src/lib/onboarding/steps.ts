export type OnboardingStepId =
  | "dashboard_new_prompt"
  | "new_request_text"
  | "new_submit_request"
  | "questions_pick"
  | "done_save";

export type OnboardingStep = {
  id: OnboardingStepId;
  route: string;
  selector: string;
  titleKey: string;
  bodyKey: string;
  advanceOn?: "click" | "next";
};

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEPS: OnboardingStep[] = [
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
];

