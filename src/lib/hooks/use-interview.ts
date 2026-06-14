import { useState, useCallback } from "react";
import * as api from "@/lib/api";
import type {
  IntentAnalysis,
  InterviewQuestion,
  AssembleResult,
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

  const requireReanswer = useCallback((next: InterviewQuestion[]) => {
    setAnswers((prev) => {
      const copy = { ...prev };
      for (const q of next) {
        // Force the UI to collect an answer even if we asked the same field earlier.
        delete copy[q.field];
      }
      return copy;
    });
  }, []);

  const handleAssembleResponse = useCallback((res: AssembleResult, textForContext: string) => {
    if (res.kind === "prompt") {
      setResult(res.prompt);
      setStep("done");
      return;
    }

    // ask_user
    requireReanswer(res.questions);
    setQuestions(res.questions);
    setStep("questions");
    // Keep originalText for subsequent /assemble calls
    setOriginalText(textForContext);
  }, [requireReanswer]);

  const awaitAssembleJob = useCallback(async (jobId: string, textForContext: string) => {
    const jobResult = await api.waitForInterviewJobResult<AssembleResult>(jobId);
    if (jobResult.error) {
      setError(jobResult.error.error);
      setStep("error");
      return;
    }

    if (!jobResult.data.result) {
      setError("Empty response from AI.");
      setStep("error");
      return;
    }

    handleAssembleResponse(jobResult.data.result, textForContext);
  }, [handleAssembleResponse]);

  const awaitAnalyzeJob = useCallback(async (jobId: string) => {
    const jobResult = await api.waitForInterviewJobResult<IntentAnalysis>(jobId);
    if (jobResult.error) {
      setError(jobResult.error.error);
      setStep("error");
      return null;
    }

    if (!jobResult.data.result) {
      setError("Empty response from AI.");
      setStep("error");
      return null;
    }

    return jobResult.data.result;
  }, []);

  const awaitQuestionsJob = useCallback(async (jobId: string) => {
    const jobResult = await api.waitForInterviewJobResult<{ questions: InterviewQuestion[] }>(jobId);
    if (jobResult.error) {
      setError(jobResult.error.error);
      setStep("error");
      return null;
    }

    if (!jobResult.data.result) {
      setError("Empty response from AI.");
      setStep("error");
      return null;
    }

    return jobResult.data.result.questions;
  }, []);

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

      const intentData = await awaitAnalyzeJob(analyzeResult.data.job.id);
      if (!intentData) {
        return;
      }

      setIntent(intentData);

      // If nothing is missing, skip straight to assembly
      if (
        !intentData.missing_fields ||
        intentData.missing_fields.length === 0
      ) {
        setStep("assembling");
        const assembleJob = await api.assemblePrompt(
          intentData,
          {},
          text,
          language
        );
        if (assembleJob.error) {
          setError(assembleJob.error.error);
          setStep("error");
          return;
        }
        await awaitAssembleJob(assembleJob.data.job.id, text);
        return;
      }

      // Otherwise get follow-up questions
      const questionsResult = await api.getQuestions(intentData, language);
      if (questionsResult.error) {
        setError(questionsResult.error.error);
        setStep("error");
        return;
      }

      const nextQuestions = await awaitQuestionsJob(questionsResult.data.job.id);
      if (!nextQuestions) {
        return;
      }

      setQuestions(nextQuestions);
      requireReanswer(nextQuestions);
      setStep("questions");
    },
    [language, awaitAnalyzeJob, awaitAssembleJob, awaitQuestionsJob, requireReanswer]
  );

  const answerQuestion = useCallback((field: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [field]: value }));
  }, []);

  const submitAnswers = useCallback(async () => {
    if (!intent) return;
    setStep("assembling");
    setError(null);

    const assembleJob = await api.assemblePrompt(
      intent,
      answers,
      originalText,
      language
    );
    if (assembleJob.error) {
      setError(assembleJob.error.error);
      setStep("error");
      return;
    }

    await awaitAssembleJob(assembleJob.data.job.id, originalText);
  }, [intent, answers, originalText, language, awaitAssembleJob]);

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
