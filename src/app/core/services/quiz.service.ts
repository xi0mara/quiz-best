import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of, shareReplay } from 'rxjs';

// ─── Tipos del JSON generado por quiz_extractor.py ───────────────────────────
export type RawQuestion = {
  id: string;
  number: number;
  type: 'single' | 'multiple' | 'torf';
  question: string;
  options: Record<string, string>;   // { "A": "texto", "B": "texto", ... }
  correctAnswer: string[];           // ["B"] o ["A","C"]
  reason?: string;
  images?: { file: string; path: string }[];
  optionsInImage?: boolean;   // ← AGREGAR
};

export type RawJson = {
  metadata: {
    version: string;
    total_questions: number;
    by_type: { single: number; multiple: number; torf: number };
    max_full_rounds: number;
    questions_per_round: number;
  };
  round_config: {
    questions_per_round: number;
    composition: { torf: number; single: number; multiple: number };
    time_per_question_seconds: number;
    show_review_after_round: boolean;
    allow_repeat_across_rounds: boolean;
  };
  questions: RawQuestion[];
};

// ─── Tipos internos del componente ───────────────────────────────────────────

export type QuizOption = { id: string; text: string };

export type QuizImage = { file: string; path: string };

export type QuizQuestion = {
  id: string;
  number: number;
  type: 'single' | 'multiple' | 'torf';
  text: string;
  options: QuizOption[];
  correctOptionIds: string[];
  reason: string;
  images: QuizImage[];   // array vacío si no tiene imágenes
  optionsInImage: boolean; // si las opciones están dentro de la imagen (ej. "¿Qué ves en esta imagen?")
};

export type QuizSettings = {
  timePerQuestionSec: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
};

export type QuizMeta = RawJson['metadata'];
export type RoundConfig = RawJson['round_config'];

// ─── Servicio ─────────────────────────────────────────────────────────────────

@Injectable({ providedIn: 'root' })
export class QuizService {
  private cache?: { settings: QuizSettings; questions: QuizQuestion[]; meta: QuizMeta; roundConfig: RoundConfig };
  private inFlight$?: Observable<{ settings: QuizSettings; questions: QuizQuestion[]; meta: QuizMeta; roundConfig: RoundConfig }>;
  // private readonly storageKey = 'quizspa.questions.v2';  // v2 por el nuevo formato
  private readonly storageKey = 'quizspa.questions';

  constructor(private http: HttpClient) {}

  // ── Carga principal ────────────────────────────────────────────────────────

loadNormalized(
  settings?: Partial<QuizSettings>,
  filename: string = 'questions.json'
): Observable<{ settings: QuizSettings; questions: QuizQuestion[]; meta: QuizMeta; roundConfig: RoundConfig }> {

  const finalSettings = this.buildSettings(settings);

  return this.http.get<RawJson>(filename).pipe(
    map((raw) => {
      const normalized = this.normalize(raw.questions ?? [], finalSettings);
      return {
        settings: finalSettings,
        questions: normalized,
        meta: raw.metadata,
        roundConfig: raw.round_config,
      };
    })
  );
}

loadNormalizedCached(
  settings?: Partial<QuizSettings>,
  opts?: { force?: boolean; useLocalStorage?: boolean; filename?: string }
): Observable<{ settings: QuizSettings; questions: QuizQuestion[]; meta: QuizMeta; roundConfig: RoundConfig }> {

  const force           = opts?.force ?? false;
  const useLocalStorage = opts?.useLocalStorage ?? true;
  const file            = opts?.filename ?? 'questions.json';

  const finalSettings = this.buildSettings(settings);

  // 🔥 CLAVE: storage dinámico por archivo
  const storageKey = `${this.storageKey}.${file}`;

  // 1. Cache memoria
  if (!force && this.cache) {
    return of(this.applySettings(this.cache.questions, finalSettings, this.cache.meta, this.cache.roundConfig));
  }

  // 2. localStorage
  if (!force && useLocalStorage) {
    const stored = localStorage.getItem(storageKey);

    if (stored) {
      try {
        const parsed = JSON.parse(stored) as {
          version: string;
          questions: QuizQuestion[];
          meta: QuizMeta;
          roundConfig: RoundConfig;
        };

        const cachedVersion = parsed.version ?? '0';
        const serverVersion = parsed.meta?.version ?? '1.0';

        if (
          cachedVersion === serverVersion &&
          Array.isArray(parsed.questions) &&
          parsed.questions.length
        ) {
          this.cache = { settings: finalSettings, ...parsed };
          return of(this.applySettings(parsed.questions, finalSettings, parsed.meta, parsed.roundConfig));
        } else {
          localStorage.removeItem(storageKey);
        }
      } catch {
        localStorage.removeItem(storageKey);
      }
    }
  }

  // 3. HTTP
  if (!force && this.inFlight$) return this.inFlight$;

  this.inFlight$ = this.loadNormalized(finalSettings, file).pipe(
    map(({ settings, questions, meta, roundConfig }) => {

      this.cache = { settings, questions, meta, roundConfig };

      if (useLocalStorage) {
        localStorage.setItem(storageKey, JSON.stringify({
          version: meta.version,   // 🔥 importante guardar versión
          questions,
          meta,
          roundConfig
        }));
      }

      return this.applySettings(questions, finalSettings, meta, roundConfig);
    }),
    shareReplay(1)
  );

  return this.inFlight$;
}

  // ── Helpers privados ───────────────────────────────────────────────────────

  private buildSettings(settings?: Partial<QuizSettings>): QuizSettings {
    return {
      timePerQuestionSec: settings?.timePerQuestionSec ?? 60,
      shuffleQuestions:   settings?.shuffleQuestions   ?? true,
      shuffleOptions:     settings?.shuffleOptions     ?? true,
    };
  }

  private normalize(raw: RawQuestion[], settings: QuizSettings): QuizQuestion[] {
    const normalized: QuizQuestion[] = raw.map((q) => {
      const opts: QuizOption[] = Object.entries(q.options ?? {}).map(([key, val]) => ({
        id: key,
        text: val,
      }));

      return {
        id: q.id,
        number: q.number,
        type: q.type ?? 'single',
        text: q.question,
        options: settings.shuffleOptions ? this.shuffle(opts) : opts,
        correctOptionIds: q.correctAnswer ?? [],
        reason: q.reason ?? '',
        images: q.images ?? [],
        optionsInImage:   q.optionsInImage ?? false,  
      };
    });

    return settings.shuffleQuestions ? this.shuffle(normalized) : normalized;
  }

  private applySettings(
    questions: QuizQuestion[],
    settings: QuizSettings,
    meta: QuizMeta,
    roundConfig: RoundConfig
  ) {
    const qs = settings.shuffleQuestions ? this.shuffle(questions) : questions;
    const out = qs.map((q) => ({
      ...q,
      options: settings.shuffleOptions ? this.shuffle(q.options) : q.options,
    }));
    return { settings, questions: out, meta, roundConfig };
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
}
