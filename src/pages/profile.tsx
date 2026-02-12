import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Shell } from "@/components/layout/shell";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { FadeIn } from "@/reactbits/fade-in";
import { t } from "@/lib/i18n";
import { useOnboarding } from "@/lib/onboarding/onboarding-context";
import * as api from "@/lib/api";
import type { TeacherProfile } from "@/lib/api";
import s from "./profile.module.css";

const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];

const AUDIENCE_OPTIONS = [
  "adults",
  "teenagers",
  "children",
  "professionals",
  "university",
] as const;

const DURATION_OPTIONS = [
  "15 min",
  "30 min",
  "45 min",
  "60 min",
  "90 min",
] as const;

export function ProfilePage() {
  const navigate = useNavigate();
  const onboarding = useOnboarding();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [profile, setProfile] = useState<TeacherProfile | null>(null);

  // Local form state
  const [languagesTaught, setLanguagesTaught] = useState("");
  const [typicalLevels, setTypicalLevels] = useState<string[]>([]);
  const [typicalAudience, setTypicalAudience] = useState<string[]>([]);
  const [typicalDuration, setTypicalDuration] = useState("");
  const [teachingContext, setTeachingContext] = useState("");

  useEffect(() => {
    api.getProfile().then((res) => {
      if (res.data) {
        const p = res.data.profile;
        setProfile(p);
        setLanguagesTaught(p.languages_taught.join(", "));
        setTypicalLevels(p.typical_levels);
        setTypicalAudience(Array.isArray(p.typical_audience) ? p.typical_audience : []);
        setTypicalDuration(p.typical_duration);
        setTeachingContext(p.teaching_context);
      }
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (loading) return;
    onboarding.maybeAutoStartProfile({ profile });
  }, [loading, profile, onboarding]);

  function toggleLevel(level: string) {
    setTypicalLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
  }

  function toggleAudience(audience: string) {
    setTypicalAudience((prev) =>
      prev.includes(audience)
        ? prev.filter((a) => a !== audience)
        : [...prev, audience]
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    const languages = languagesTaught
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const data: Partial<TeacherProfile> = {
      languages_taught: languages,
      typical_levels: typicalLevels,
      typical_audience: typicalAudience,
      typical_duration: typicalDuration,
      teaching_context: teachingContext,
      setup_completed: true,
    };

    const res = await api.updateProfile(data);
    if (res.data) {
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }
    setSaving(false);
  }

  if (loading) {
    return (
      <Shell>
        <Spinner />
      </Shell>
    );
  }

  return (
    <Shell>
      <FadeIn delay={0.1} duration={0.4} direction="up" distance={12}>
        <div className={s.header}>
          <h1 className={s.title}>{t("profile.title")}</h1>
          <p className={s.subtitle}>{t("profile.subtitle")}</p>
        </div>
      </FadeIn>

      <FadeIn delay={0.2} duration={0.5} direction="up" distance={16}>
        <Card variant="bordered">
          <form onSubmit={handleSave} className={s.form}>
            {/* Languages taught */}
            <div>
              <label htmlFor="languages-taught" className={s.fieldLabel}>
                {t("profile.languages_taught")}
              </label>
              <Input
                id="languages-taught"
                value={languagesTaught}
                onChange={(e) => setLanguagesTaught(e.target.value)}
                placeholder={t("profile.languages_taught_hint")}
                data-onboard="profile-languages"
              />
              <p className={s.fieldHint}>{t("profile.languages_taught_hint")}</p>
            </div>

            {/* Typical levels */}
            <div role="group" aria-labelledby="levels-label">
              <span id="levels-label" className={s.fieldLabel}>
                {t("profile.typical_levels")}
              </span>
              <div className={s.chipGroup} data-onboard="profile-levels">
                {LEVELS.map((level) => (
                  <button
                    key={level}
                    type="button"
                    className={`${s.chip} ${typicalLevels.includes(level) ? s.chipSelected : ""}`}
                    onClick={() => toggleLevel(level)}
                    aria-pressed={typicalLevels.includes(level)}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>

            {/* Typical audience */}
            <div role="group" aria-labelledby="audience-label">
              <span id="audience-label" className={s.fieldLabel}>
                {t("profile.typical_audience")}
              </span>
              <div className={s.chipGroup} data-onboard="profile-audience">
                {AUDIENCE_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`${s.chip} ${typicalAudience.includes(opt) ? s.chipSelected : ""}`}
                    onClick={() => toggleAudience(opt)}
                    aria-pressed={typicalAudience.includes(opt)}
                  >
                    {t(`profile.audience_${opt}`)}
                  </button>
                ))}
              </div>
            </div>

            {/* Typical duration */}
            <div role="group" aria-labelledby="duration-label">
              <span id="duration-label" className={s.fieldLabel}>
                {t("profile.typical_duration")}
              </span>
              <div className={s.chipGroup} data-onboard="profile-duration">
                {DURATION_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    className={`${s.chip} ${typicalDuration === opt ? s.chipSelected : ""}`}
                    onClick={() =>
                      setTypicalDuration(typicalDuration === opt ? "" : opt)
                    }
                    aria-pressed={typicalDuration === opt}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>

            {/* Teaching context */}
            <div>
              <label htmlFor="teaching-context" className={s.fieldLabel}>
                {t("profile.teaching_context")}
              </label>
              <Input
                id="teaching-context"
                value={teachingContext}
                onChange={(e) => setTeachingContext(e.target.value)}
                placeholder={t("profile.teaching_context_hint")}
                data-onboard="profile-context"
              />
            </div>

            <div className={s.footer}>
              <Button type="submit" variant="cta" disabled={saving}>
                {saving ? t("common.saving") : t("profile.save")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onboarding.start("profile", "manual")}
                data-onboard="profile-save"
              >
                {t("onboarding.profile.replay")}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => onboarding.start("main", "manual")}
              >
                {t("onboarding.main.replay")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => navigate("/dashboard")}>
                {t("common.back")}
              </Button>
              {saved && <span className={s.savedMsg}>{t("profile.saved")}</span>}
            </div>
          </form>
        </Card>
      </FadeIn>
    </Shell>
  );
}
