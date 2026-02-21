import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import { QuizQuestion, QuizService, QuizSettings } from '../../core/services/quiz.service';

type State = 'loading' | 'playing' | 'answered' | 'roundSummary' | 'finished' | 'error';

type RoundAnswer = {
  q: QuizQuestion;
  selectedId: string | null;      // lo que marcó
  correctIds: string[];           // respuesta(s) correcta(s)
  isCorrect: boolean;             // si acertó
  timeSpentSec: number;           // opcional (simple)
};

@Component({
  selector: 'app-quiz',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './quiz.component.html',
  styleUrl: './quiz.component.scss',
})
export class QuizComponent implements OnInit, OnDestroy {
  state: State = 'loading';
  errorMsg = '';
  private questionStartedAt = 0;
  settings!: QuizSettings;
  private pool: QuizQuestion[] = [];  // Banco total para esta sesión (ya mezclado, sin repetir)
  readonly roundSize = 5;
  roundQuestions: QuizQuestion[] = [];
  roundIndex = 0;
  correctTotal = 0;   // Puntuación global
  wrongTotal = 0; 
  timeLeft = 0; // Estado por pregunta
  selectedId: string | null = null;
  isCorrect: boolean | null = null;
  roundAnswers: RoundAnswer[] = []; // Resumen del round (5 items)
  totalQuestions = 0; // Contadores globales
  answeredQuestions = 0; // cuántas ya jugaste

  private timerSub?: Subscription;

  constructor(
    private quiz: QuizService,
    private cdr: ChangeDetectorRef
) {}

  ngOnInit(): void {
    this.state = 'loading';

    this.quiz
      .loadNormalizedCached(
        { timePerQuestionSec: 15, shuffleQuestions: true, shuffleOptions: true },
        { useLocalStorage: true }
      )
      .subscribe({
        next: ({ settings, questions }) => {
          this.settings = settings;

          // Pool de sesión: barajado 1 vez -> NO se repite nunca
          this.pool = [...questions];
          this.totalQuestions = this.pool.length;

          if (!this.totalQuestions) {
            this.state = 'error';
            this.errorMsg = 'No hay preguntas en public/questions.json';
            return;
          }

          this.startNewRound();
        },
        error: (err) => {
          console.error(err);
          this.state = 'error';
          this.errorMsg = 'No se pudo cargar questions.json (revisa /public/questions.json).';
        },
      });
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  get q(): QuizQuestion {
    return this.roundQuestions[this.roundIndex];
  }

  get globalProgressPct(): number {
    if (!this.totalQuestions) return 0;
    return Math.round((this.answeredQuestions / this.totalQuestions) * 100);
  }

  get inRoundNumber(): number {
    return this.roundIndex + 1;
  }

  get roundNumber(): number {
    const played = this.answeredQuestions;
    return Math.floor(played / this.roundSize) + 1;
  }

  private startNewRound(): void {
    this.stopTimer();

    if (!this.pool.length) {
      this.state = 'finished';
      return;
    }

    this.roundQuestions = this.pool.splice(0, this.roundSize);
    this.roundIndex = 0;
    this.roundAnswers = [];

    this.state = 'playing';
    this.startQuestion();
  }

  private startQuestion(): void {
  this.selectedId = null;
  this.isCorrect = null;

  this.timeLeft = this.settings.timePerQuestionSec;
  this.questionStartedAt = Date.now();

  this.state = 'playing';
  this.startTimer();
  }

 private startTimer(): void {
  this.stopTimer();

  this.updateTimeLeft();

  this.timerSub = interval(250).subscribe(() => {
    this.updateTimeLeft();
  });
}

private updateTimeLeft(): void {
  if (this.state !== 'playing') return;

  const elapsedSec = Math.floor((Date.now() - this.questionStartedAt) / 1000);
  const remaining = this.settings.timePerQuestionSec - elapsedSec;

  this.timeLeft = Math.max(0, remaining);

  this.cdr.detectChanges();

  if (this.timeLeft === 0) {
    this.answer(null);
  }

  console.log('tick', this.timeLeft);
}

  private stopTimer(): void {
    this.timerSub?.unsubscribe();
    this.timerSub = undefined;
  }

  answer(optionId: string | null, timeSpentSec?: number): void {
    if (this.state !== 'playing') return;

    this.stopTimer();
    this.state = 'answered';
    this.selectedId = optionId;

    const correctIds = this.q.correctOptionIds ?? [];
    const ok = optionId ? correctIds.includes(optionId) : false;

    this.isCorrect = ok;

    if (ok) this.correctTotal++;
    else this.wrongTotal++;

    this.answeredQuestions++;

    // Guardamos al resumen del round
    this.roundAnswers.push({
      q: this.q,
      selectedId: optionId,
      correctIds,
      isCorrect: ok,
      timeSpentSec: timeSpentSec ?? (this.settings.timePerQuestionSec - this.timeLeft),
    });
  }

  nextQuestionOrSummary(): void {
    // si aún quedan preguntas dentro del round actual
    if (this.roundIndex < this.roundQuestions.length - 1) {
      this.roundIndex++;
      this.state = 'playing';
      this.startQuestion();
      return;
    }

    // terminó el round -> mostrar resumen
    this.state = 'roundSummary';
  }

  continueNextRound(): void {
    this.startNewRound();
  }

  restartAll(): void {
    this.stopTimer();
    this.correctTotal = 0;
    this.wrongTotal = 0;
    this.answeredQuestions = 0;
    this.roundQuestions = [];
    this.roundAnswers = [];
    this.roundIndex = 0;
    this.selectedId = null;
    this.isCorrect = null;
    this.timeLeft = 0;

    // Reiniciamos todo (vuelve a cargar desde caché y reshuffle)
    this.ngOnInit();
  }

  // ===== Styling helpers =====
  optionClass(optionId: string): string {
    if (this.state === 'playing') return '';

    const isRight = this.q.correctOptionIds.includes(optionId);
    const isSelected = optionId === this.selectedId;

    if (isRight) return 'correct';
    if (isSelected && !isRight) return 'wrong';
    return 'dim';
  }

  // Para mostrar texto de opción marcada/correcta en el resumen
  labelForOption(q: QuizQuestion, optionId: string | null): string {
    if (!optionId) return 'Sin respuesta';
    const opt = q.options.find((o) => o.id === optionId);
    return opt ? `${opt.id}: ${opt.text}` : optionId;
  }

  correctLabels(q: QuizQuestion): string {
    const ids = q.correctOptionIds ?? [];
    if (!ids.length) return '-';
    return ids
      .map((id) => {
        const opt = q.options.find((o) => o.id === id);
        return opt ? `${opt.id}: ${opt.text}` : id;
      })
      .join(' | ');
  }
}