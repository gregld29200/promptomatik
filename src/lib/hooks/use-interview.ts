import { useState, useCallback } from "react";
import * as api from "@/lib/api";
import type {
  IntentAnalysis,
  InterviewQuestion,
  AssembledPrompt,
} from "@/lib/api";
import { getLanguage } from "@/lib/i18n";

export type InterviewStep =
  | "input"
  | "analyzing"
  | "questions"
  | "assembling"
  | "done"
  | "error";

export function useInterview() {
  const [step, setStep] = useState<InterviewStep>("input");
  const [originalText, setOriginalText] = useState("");
  const [intent, setIntent] = useState<IntentAnalysis | null>(null);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<AssembledPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);

  const language = getLanguage();

  const submitText = useCallback(
    async (text: string) => {
      setOriginalText(text);
      setStep("analyzing");
      setError(null);

      const analyzeResult = await api.analyzeIntent(text, language);
      if (analyzeResult.error) {
        setError(analyzeResult.error.error);
        setStep("error");
        return;
      }

      const intentData = analyzeResult.data.intent;
      setIntent(intentData);

      // If nothing is missing, skip straight to assembly
      if (
        !intentData.missing_fields ||
        intentData.missing_fields.length === 0
      ) {
        setStep("assembling");
        const assembleResult = await api.assemblePrompt(
          intentData,
          {},
          text,
          language
        );
        if (assembleResult.error) {
          setError(assembleResult.error.error);
          setStep("error");
          return;
        }
        setResult(assembleResult.data.prompt);
        setStep("done");
        return;
      }

      // Otherwise get follow-up questions
      const questionsResult = await api.getQuestions(intentData, language);
      if (questionsResult.error) {
        setError(questionsResult.error.error);
        setStep("error");
        return;
      }

      setQuestions(questionsResult.data.questions);
      setStep("questions");
    },
    [language]
  );

  const answerQuestion = useCallback((field: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  }, []);

  const submitAnswers = useCallback(async () => {
    if (!intent) return;
    setStep("assembling");
    setError(null);

    const assembleResult = await api.assemblePrompt(
      intent,
      answers,
      originalText,
      language
    );
    if (assembleResult.error) {
      setError(assembleResult.error.error);
      setStep("error");
      return;
    }

    setResult(assembleResult.data.prompt);
    setStep("done");
  }, [intent, answers, originalText, language]);

  const reset = useCallback(() => {
    setStep("input");
    setOriginalText("");
    setIntent(null);
    setQuestions([]);
    setAnswers({});
    setResult(null);
    setError(null);
  }, []);

  return {
    step,
    originalText,
    intent,
    questions,
    answers,
    result,
    error,
    submitText,
    answerQuestion,
    submitAnswers,
    reset,
  };
}
