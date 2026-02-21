import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map, of, shareReplay } from 'rxjs';

export type RawQuestion = {
  id: string;
  num: number;
  type: 'single' | 'multi';
  question: string;
  options: Record<string, string>;
  answer: string[];
  reason?: string;
};

export type QuizOption = { id: string; text: string };

export type QuizQuestion = {
  id: string;
  num: number;
  type: 'single' | 'multi';
  text: string;
  options: QuizOption[];
  correctOptionIds: string[];
  reason?: string;
};

export type QuizSettings = {
  timePerQuestionSec: number;
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
};

@Injectable({ providedIn: 'root' })
export class QuizService {
  private cache?: { settings: QuizSettings; questions: QuizQuestion[] };
  private inFlight$?: Observable<{ settings: QuizSettings; questions: QuizQuestion[] }>;
  private readonly storageKey = 'quizspa.questions.v1';

  constructor(private http: HttpClient) {}

  loadNormalized(settings?: Partial<QuizSettings>): Observable<{ settings: QuizSettings; questions: QuizQuestion[] }> {
    const finalSettings: QuizSettings = {
      timePerQuestionSec: settings?.timePerQuestionSec ?? 15,
      shuffleQuestions: settings?.shuffleQuestions ?? true,
      shuffleOptions: settings?.shuffleOptions ?? true,
    };

    return this.http.get<RawQuestion[]>('questions.json').pipe(
      map((raw) => {
        const normalized: QuizQuestion[] = (raw ?? []).map((q) => {
          const opts: QuizOption[] = Object.entries(q.options ?? {}).map(([key, value]) => ({
            id: key,
            text: value,
          }));

          return {
            id: q.id,
            num: q.num,
            type: q.type ?? 'single',
            text: q.question,
            options: finalSettings.shuffleOptions ? this.shuffle(opts) : opts,
            correctOptionIds: q.answer ?? [],
            reason: q.reason ?? '',
          };
        });

        const questions = finalSettings.shuffleQuestions ? this.shuffle(normalized) : normalized;
        return { settings: finalSettings, questions };
      })
    );
  }

  loadNormalizedCached(
    settings?: Partial<QuizSettings>,
    opts?: { force?: boolean; useLocalStorage?: boolean }
  ): Observable<{ settings: QuizSettings; questions: QuizQuestion[] }> {
    const force = opts?.force ?? false;
    const useLocalStorage = opts?.useLocalStorage ?? true;

    const finalSettings: QuizSettings = {
      timePerQuestionSec: settings?.timePerQuestionSec ?? 15,
      shuffleQuestions: settings?.shuffleQuestions ?? true,
      shuffleOptions: settings?.shuffleOptions ?? true,
    };

    if (!force && this.cache) {
      return of(this.applySettings(this.cache.questions, finalSettings));
    }

    if (!force && useLocalStorage) {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as { questions: QuizQuestion[] };
          if (Array.isArray(parsed.questions) && parsed.questions.length) {
            this.cache = { settings: finalSettings, questions: parsed.questions };
            return of(this.applySettings(this.cache.questions, finalSettings));
          }
        } catch {
        }
      }
    }

    if (!force && this.inFlight$) return this.inFlight$;

    this.inFlight$ = this.loadNormalized(finalSettings).pipe(
      map(({ settings, questions }) => {
        this.cache = { settings, questions };

        if (useLocalStorage) {
          localStorage.setItem(this.storageKey, JSON.stringify({ questions }));
        }

        return this.applySettings(questions, finalSettings);
      }),
      shareReplay(1)
    );

    return this.inFlight$;
  }

  loadFirstBatch(
    firstCount = 5,
    settings?: Partial<QuizSettings>
  ): Observable<{ settings: QuizSettings; first: QuizQuestion[]; rest: QuizQuestion[] }> {
    return this.loadNormalizedCached(settings, { useLocalStorage: true }).pipe(
      map(({ settings, questions }) => {
        const shuffled = this.shuffle(questions);
        const first = shuffled.slice(0, firstCount);
        const rest = shuffled.slice(firstCount);
        return { settings, first, rest };
      })
    );
  }

  // Re-aplica shuffle de sesión (sin tocar el cache persistido)
  private applySettings(questions: QuizQuestion[], settings: QuizSettings) {
    const qs = settings.shuffleQuestions ? this.shuffle(questions) : questions;
    const out = qs.map((q) => ({
      ...q,
      options: settings.shuffleOptions ? this.shuffle(q.options) : q.options,
    }));
    return { settings, questions: out };
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