import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Loader2, RotateCcw, X } from "lucide-react";
import * as api from "@/lib/api";
import { documentErrorMessage, saveDesign } from "@/lib/documents-page";
import { t } from "@/lib/i18n";
import s from "./document-design-panel.module.css";

const ACCENTS = ["#243b61", "#2c5f7c", "#315f70", "#355343", "#7fa99b", "#a35d45", "#c08a1e", "#6b4c8a"];
const HEADING_FONTS: api.DocumentHeadingFont[] = ["cormorant", "fraunces", "playfair", "space_grotesk", "inter", "manrope"];
const BODY_FONTS: api.DocumentBodyFont[] = ["source_sans", "nunito_sans", "manrope", "inter"];
const FONT_PREVIEW: Record<string, string> = {
  cormorant: "'Cormorant Garamond', Georgia, serif",
  fraunces: "Fraunces, Georgia, serif",
  playfair: "'Playfair Display', Georgia, serif",
  space_grotesk: "'Space Grotesk', sans-serif",
  inter: "Inter, sans-serif",
  manrope: "Manrope, sans-serif",
  source_sans: "'Source Sans 3', sans-serif",
  nunito_sans: "'Nunito Sans', sans-serif",
};

interface DocumentDesignPanelProps {
  jobId: string;
  index: number;
  design: api.DocumentDesign;
  orientation: api.DocumentOrientation;
  /** Called once the server has the new presentation, to refresh the preview. */
  onSaved: (job: api.DocumentJob) => void;
}

/**
 * "Personnaliser": the teacher's own look on top of a style. Every change is
 * presentation only, saved on the document at once and remembered for the
 * next documents. The words never pass through here.
 */
export function DocumentDesignPanel({ jobId, index, design: initialDesign, orientation: initialOrientation, onSaved }: DocumentDesignPanelProps) {
  const [design, setDesign] = useState<api.DocumentDesign>(initialDesign);
  const [orientation, setOrientation] = useState<api.DocumentOrientation>(initialOrientation);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function persist(nextDesign: api.DocumentDesign, nextOrientation: api.DocumentOrientation, delay = 350) {
    window.clearTimeout(timer.current);
    setStatus("saving");
    timer.current = window.setTimeout(async () => {
      const cleaned = Object.fromEntries(
        Object.entries(nextDesign).filter(([, value]) => value !== undefined && value !== ""),
      ) as api.DocumentDesign;
      saveDesign(cleaned);
      const res = await api.updateDocumentPresentation(jobId, index, { design: cleaned, orientation: nextOrientation });
      if (res.error) {
        setStatus("error");
        return;
      }
      setStatus("saved");
      onSaved(res.data.job);
    }, delay);
  }

  function update<Key extends keyof api.DocumentDesign>(key: Key, value: api.DocumentDesign[Key], delay?: number) {
    const next = { ...design, [key]: value };
    setDesign(next);
    persist(next, orientation, delay);
  }

  function changeOrientation(next: api.DocumentOrientation) {
    setOrientation(next);
    persist(design, next, 0);
  }

  function reset() {
    setDesign({});
    persist({}, orientation, 0);
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploadError(null);
    if (file.size > api.DOCUMENT_IMAGE_MAX_BYTES) {
      setUploadError(t("documents.image_too_large"));
      return;
    }
    setUploading(true);
    const result = await api.uploadDocumentImage(file);
    setUploading(false);
    if ("error" in result) {
      setUploadError(documentErrorMessage(result.error));
      return;
    }
    update("logoImageId", result.id, 0);
  }

  return (
    <section className={s.panel} aria-labelledby="design-panel-title">
      <div className={s.head}>
        <h3 id="design-panel-title">{t("documents.design.title")}</h3>
        <span className={s.status} aria-live="polite">
          {status === "saving" && t("documents.design.saving")}
          {status === "saved" && t("documents.design.saved")}
          {status === "error" && t("documents.design.error")}
        </span>
      </div>

      <fieldset className={s.group}>
        <legend>{t("documents.design.orientation")}</legend>
        <div className={s.segmented}>
          {(["portrait", "landscape"] as const).map((value) => (
            <button key={value} type="button" aria-pressed={orientation === value} onClick={() => changeOrientation(value)}>
              {t(`documents.design.orientations.${value}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={s.group}>
        <legend>{t("documents.design.accent")}</legend>
        <div className={s.swatches}>
          {ACCENTS.map((color) => (
            <button
              key={color}
              type="button"
              className={s.swatch}
              style={{ background: color }}
              aria-pressed={design.accent?.toLowerCase() === color}
              aria-label={t("documents.design.accent_choice", { color })}
              onClick={() => update("accent", color, 0)}
            />
          ))}
          <label className={s.customColor}>
            <input
              type="color"
              value={design.accent ?? "#243b61"}
              onChange={(event) => update("accent", event.target.value)}
              aria-label={t("documents.design.accent_custom")}
            />
            <span>{t("documents.design.accent_custom")}</span>
          </label>
        </div>
      </fieldset>

      <div className={s.row}>
        <label className={s.select}>
          <span>{t("documents.design.heading_font")}</span>
          <select
            value={design.headingFont ?? ""}
            onChange={(event) => update("headingFont", (event.target.value || undefined) as api.DocumentHeadingFont | undefined, 0)}
          >
            <option value="">{t("documents.design.style_default")}</option>
            {HEADING_FONTS.map((font) => (
              <option key={font} value={font} style={{ fontFamily: FONT_PREVIEW[font] }}>{t(`documents.design.fonts.${font}`)}</option>
            ))}
          </select>
        </label>
        <label className={s.select}>
          <span>{t("documents.design.body_font")}</span>
          <select
            value={design.bodyFont ?? ""}
            onChange={(event) => update("bodyFont", (event.target.value || undefined) as api.DocumentBodyFont | undefined, 0)}
          >
            <option value="">{t("documents.design.style_default")}</option>
            {BODY_FONTS.map((font) => (
              <option key={font} value={font} style={{ fontFamily: FONT_PREVIEW[font] }}>{t(`documents.design.fonts.${font}`)}</option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className={s.group}>
        <legend>{t("documents.design.density")}</legend>
        <div className={s.segmented}>
          {(["airy", "standard", "compact"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={(design.density ?? "standard") === value}
              onClick={() => update("density", value === "standard" ? undefined : value, 0)}
            >
              {t(`documents.design.densities.${value}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={s.group}>
        <legend>{t("documents.design.header")}</legend>
        <div className={s.segmented}>
          {(["", "rule", "band", "frame"] as const).map((value) => (
            <button
              key={value || "default"}
              type="button"
              aria-pressed={(design.header ?? "") === value}
              onClick={() => update("header", value || undefined, 0)}
            >
              {t(`documents.design.headers.${value || "default"}`)}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={s.group}>
        <legend>{t("documents.design.logo")}</legend>
        <div className={s.logoRow}>
          {design.logoImageId ? (
            <>
              <img className={s.logoThumb} src={api.documentImageUrl(design.logoImageId)} alt={t("documents.design.logo_alt")} />
              <button type="button" className={s.textButton} onClick={() => update("logoImageId", undefined, 0)}>
                <X size={15} aria-hidden /> {t("documents.design.logo_remove")}
              </button>
            </>
          ) : (
            <button type="button" className={s.textButton} onClick={() => fileInput.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 size={15} className={s.spin} aria-hidden /> : <ImagePlus size={15} aria-hidden />}
              {t("documents.design.logo_add")}
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => void uploadLogo(event)} />
        </div>
        {uploadError && <p className={s.error}>{uploadError}</p>}
      </fieldset>

      <label className={s.select}>
        <span>{t("documents.design.footer")}</span>
        <input
          value={design.footerText ?? ""}
          maxLength={120}
          placeholder={t("documents.design.footer_placeholder")}
          onChange={(event) => update("footerText", event.target.value || undefined, 600)}
        />
      </label>

      <button type="button" className={s.textButton} onClick={reset}>
        <RotateCcw size={15} aria-hidden /> {t("documents.design.reset")}
      </button>
    </section>
  );
}
