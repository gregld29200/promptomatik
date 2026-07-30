import { useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, BookOpen, CalendarDays, Expand, GraduationCap, ListChecks } from "lucide-react";
import { UpgradeGate } from "@/components/upgrade-gate";
import { t } from "@/lib/i18n";
import s from "./document-teaser.module.css";

type PreviewId = "reading" | "worksheet" | "teacher_guide" | "lesson_plan";

interface Preview {
  id: PreviewId;
  image: string;
  Icon: typeof BookOpen;
  sourceTitle: string;
  sourceParagraphs: string[];
}

const PREVIEWS: Preview[] = [
  {
    id: "reading",
    image: "/images/documents-teaser/reading.webp",
    Icon: BookOpen,
    sourceTitle: "The meeting-free morning",
    sourceParagraphs: [
      "Last September, a customer service company in Bristol introduced a meeting-free morning. Every Tuesday, employees could work from 9 a.m. to 12 p.m. without meetings, internal calls or non-urgent messages.",
      "The idea came from a staff survey. Many employees said that constant interruptions made it difficult to finish important tasks. Managers therefore decided to protect three hours of focus time each week.",
      "During the first month, some teams found the new schedule difficult. Clients still needed quick answers, and urgent problems could not wait. The company created a rotating support team to handle these situations while the other employees worked quietly.",
      "To make the system clearer, managers agreed on a simple definition of an urgent request. A message was urgent only when waiting until midday could affect a customer, stop another team from working or create a financial risk. Everything else went into a shared list for the afternoon.",
      "Employees also changed some of their habits. They prepared their Tuesday priorities on Monday afternoon, closed messaging applications and told colleagues which task they planned to complete. The support team received a short handover before 9 a.m. so that it could answer routine questions without interrupting specialists.",
      "Managers followed the experiment for three months. They compared the number and complexity of completed tasks, checked response times for customers and asked employees about stress. Customer satisfaction remained stable, while most urgent requests were answered within the usual time.",
      "After the three-month trial, the company compared the results. Employees completed more complex tasks, reported less stress and made fewer mistakes. The meeting-free morning is now part of the normal weekly schedule, and other departments are considering a similar protected period.",
    ],
  },
  {
    id: "worksheet",
    image: "/images/documents-teaser/worksheet.webp",
    Icon: ListChecks,
    sourceTitle: "The meeting-free morning: Activities",
    sourceParagraphs: [
      "COMPREHENSION\nAnswer the questions in complete sentences.",
      "1. What change did the company introduce last September?\n2. Why did employees want more uninterrupted working time?\n3. What problem did some teams experience during the first month?\n4. How did the company continue to manage urgent requests?\n5. What three positive results did the company observe after the trial?",
      "VOCABULARY\nMatch each expression from the text with its definition.\n\n1. focus time\n2. interruptions\n3. urgent\n4. schedule\n5. trial",
      "A. A plan showing when activities or tasks happen\nB. A limited period used to test a new idea\nC. Periods when something stops or disturbs your work\nD. Time protected for concentrated work\nE. Needing immediate attention or action",
      "YOUR ANSWERS\n1. ______\n2. ______\n3. ______\n4. ______\n5. ______",
      "DISCUSSION\nWould a meeting-free morning improve the way you or your team works? Explain your answer and give one possible advantage and one possible difficulty.",
    ],
  },
  {
    id: "teacher_guide",
    image: "/images/documents-teaser/teacher-guide.webp",
    Icon: GraduationCap,
    sourceTitle: "The meeting-free morning: Teacher's guide",
    sourceParagraphs: [
      "Level: B1\nAudience: Adult English learners\nSuggested duration: 45 minutes",
      "LEARNING OBJECTIVES\nBy the end of the lesson, learners will be able to identify the main idea and key details in a workplace text, explain why the company introduced a meeting-free morning, use five expressions related to organisation and productivity, and discuss the advantages and difficulties of uninterrupted working time.",
      "COMPREHENSION ANSWERS\n1. The company introduced a meeting-free morning every Tuesday from 9 a.m. to 12 p.m.\n\n2. Employees said that constant interruptions made it difficult to finish important tasks.\n\n3. Clients still needed quick answers, and urgent problems could not wait until the meeting-free period ended.\n\n4. The company created a rotating support team to handle urgent situations while the other employees worked quietly.\n\n5. Employees completed more complex tasks, reported less stress and made fewer mistakes.",
      "VOCABULARY GUIDE\nFocus time: a period when someone can concentrate on an important task without interruptions.\n\nInterruptions: events, messages or people that temporarily stop someone from working.\n\nUrgent: requiring immediate attention or action.\n\nSchedule: a plan that shows when activities or tasks happen.\n\nTrial: a limited period used to test a new idea.",
      "TEACHING NOTE\nAsk learners to justify each comprehension answer with evidence from the reading. During the discussion, encourage them to identify both a practical benefit and a realistic difficulty before proposing a solution for urgent requests.",
    ],
  },
  {
    id: "lesson_plan",
    image: "/images/documents-teaser/lesson-plan.webp",
    Icon: CalendarDays,
    sourceTitle: "The meeting-free morning: 45-minute lesson plan",
    sourceParagraphs: [
      "Level: B1\nAudience: Adult English learners\nDuration: 45 minutes\nMain skills: Reading, vocabulary and speaking",
      "LESSON OBJECTIVES\nUnderstand the main ideas and important details of a workplace text. Use vocabulary related to time management and productivity. Discuss the benefits and limitations of a meeting-free morning. Propose a practical change to improve concentration at work.",
      "MATERIALS\nThe meeting-free morning reading text\nComprehension and vocabulary worksheet\nBoard or shared screen\nPens or digital note-taking tools",
      "WARM-UP\nTime: 5 minutes\nInteraction: Pairs, then whole class\n\nWrite this question on the board: What usually interrupts you when you are trying to concentrate? Learners discuss the question in pairs and identify two common interruptions. Invite several learners to share their answers with the class.",
      "FIRST READING\nTime: 7 minutes\nInteraction: Individual work, then pairs\n\nLearners read the text quickly without using a dictionary. Ask why the company introduced a meeting-free morning and whether the experiment was successful. Learners compare their answers with a partner before a brief class check.",
      "DETAILED COMPREHENSION\nTime: 10 minutes\nInteraction: Individual work, then pairs\n\nLearners read the text again and answer the five comprehension questions in complete sentences. They compare answers and identify the sentence in the text that supports each response.",
      "VOCABULARY WORK\nTime: 8 minutes\nInteraction: Pairs\n\nLearners match focus time, interruptions, urgent, schedule and trial with their definitions. Each pair then chooses three expressions and writes a new workplace example for each one.",
      "PAIR DISCUSSION\nTime: 10 minutes\nInteraction: Pairs\n\nWould a meeting-free morning improve the way you or your team works? Include one possible advantage, one possible difficulty and one practical solution for urgent requests.",
      "FINAL REFLECTION\nTime: 5 minutes\nInteraction: Individual work, then whole class\n\nLearners complete two sentences: One useful idea from today's lesson is... One change that could help me concentrate is...",
      "OPTIONAL HOMEWORK\nWrite a short email of 100 to 120 words to a manager proposing one regular period of uninterrupted work. Explain when it should take place, why it would be useful and how urgent requests could still be handled.",
    ],
  },
];

export function DocumentTeaser() {
  const [activeId, setActiveId] = useState<PreviewId>("reading");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const active = PREVIEWS.find((preview) => preview.id === activeId) ?? PREVIEWS[0];

  function selectFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();

    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % PREVIEWS.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + PREVIEWS.length) % PREVIEWS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = PREVIEWS.length - 1;

    setActiveId(PREVIEWS[nextIndex].id);
    tabRefs.current[nextIndex]?.focus();
  }

  return (
    <main className={s.teaser}>
      <div className={s.upgradeBanner}>
        <UpgradeGate variant="conclusion" message={t("documents_teaser.locked_message")} />
      </div>

      <header className={s.header}>
        <p className={s.eyebrow}>{t("documents_teaser.eyebrow")}</p>
        <h1>{t("documents_teaser.title")}</h1>
        <p>{t("documents_teaser.intro")}</p>
      </header>

      <section className={s.workbench} aria-label={t("documents_teaser.demo_label")}>
        <article className={s.sourceCard}>
          <div className={s.sourceHeading}>
            <p className={s.sourceLabel}>{t("documents_teaser.source_label")}</p>
            <span className={s.sourceNumber} aria-hidden="true">01</span>
          </div>
          <p className={s.sourceMeta}>{t("documents_teaser.source_meta")}</p>
          <div
            className={s.sourceText}
            lang="en"
            role="textbox"
            aria-readonly="true"
            aria-label={t("documents_teaser.source_label")}
            tabIndex={0}
          >
            <p className={s.rawTitle}>{active.sourceTitle}</p>
            {active.sourceParagraphs.map((paragraph) => (
              <p key={paragraph}>
                {paragraph}
              </p>
            ))}
          </div>
          <p className={s.sourceNote}>{t("documents_teaser.source_note")}</p>
        </article>

        <div className={s.flowMarker} aria-hidden="true">
          <ArrowRight size={21} />
        </div>

        <div className={s.previewArea}>
          <div className={s.previewTopline}>
            <div>
              <p className={s.previewLabel}>{t("documents_teaser.preview_label")}</p>
              <p className={s.previewTitle}>{t(`documents_teaser.tabs.${active.id}`)}</p>
            </div>
            <div className={s.styleSummary}>
              <span>{t("documents_teaser.style_label")}</span>
              <strong>{t("documents_teaser.style_name")}</strong>
              <small>{t("documents_teaser.style_count")}</small>
            </div>
          </div>

          <div className={s.tabs} role="tablist" aria-label={t("documents_teaser.tabs_label")}>
            {PREVIEWS.map(({ id, Icon }, index) => {
              const selected = id === active.id;
              return (
                <button
                  key={id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  id={`document-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls="document-preview-panel"
                  tabIndex={selected ? 0 : -1}
                  className={selected ? s.activeTab : undefined}
                  onClick={() => setActiveId(id)}
                  onKeyDown={(event) => selectFromKeyboard(event, index)}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{t(`documents_teaser.tabs.${id}`)}</span>
                </button>
              );
            })}
          </div>

          <div
            id="document-preview-panel"
            className={s.previewPanel}
            role="tabpanel"
            aria-labelledby={`document-tab-${active.id}`}
            tabIndex={0}
          >
            <div className={s.paperStack} aria-hidden="true" />
            <img
              key={active.id}
              src={active.image}
              alt={t(`documents_teaser.alts.${active.id}`)}
              className={`${s.previewImage} ${s[active.id]}`}
              draggable="false"
            />
            <a
              href={active.image}
              target="_blank"
              rel="noreferrer"
              className={s.expandLink}
              aria-label={t("documents_teaser.expand_label", {
                type: t(`documents_teaser.tabs.${active.id}`),
              })}
            >
              <Expand size={16} aria-hidden="true" />
              {t("documents_teaser.expand")}
            </a>
          </div>
        </div>
      </section>

      <p className={s.outputNote}>{t("documents_teaser.output_note")}</p>
    </main>
  );
}
