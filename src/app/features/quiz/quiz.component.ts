import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription, interval } from 'rxjs';
import {
  QuizQuestion,
  QuizService,
  QuizSettings,
  QuizMeta,
  RoundConfig,
} from '../../core/services/quiz.service';

// 'select' → pantalla de selección de banco (antes de cargar nada)
type State = 'select' | 'loading' | 'playing' | 'answered' | 'roundSummary' | 'finished' | 'error';

type RoundAnswer = {
  q: QuizQuestion;
  selectedIds: string[];
  correctIds: string[];
  isCorrect: boolean;
  timeSpentSec: number;
};

@Component({
  selector: 'app-quiz',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './quiz.component.html',
  styleUrl: './quiz.component.scss',
})
export class QuizComponent implements OnInit, OnDestroy {
  state: State = 'select';   // ← arranca en selección, NO en loading
  errorMsg = '';

  /** Archivo JSON activo. Se asigna al hacer clic en uno de los botones. */
  selectedFile: string | null = null;

  settings!: QuizSettings;
  meta!: QuizMeta;
  roundConfig!: RoundConfig;

  private pool: QuizQuestion[] = [];

  get roundSize(): number {
    return this.roundConfig?.questions_per_round ?? 60;
  }

  // ── Estado por ronda ──────────────────────────────────────────────────────
  roundQuestions: QuizQuestion[] = [];
  roundIndex    = 0;
  roundAnswers: RoundAnswer[] = [];

  // ── Contadores globales ───────────────────────────────────────────────────
  correctTotal      = 0;
  wrongTotal        = 0;
  answeredQuestions = 0;
  totalQuestions    = 0;

  // ── Cronómetro por pregunta ───────────────────────────────────────────────
  timeLeft               = 0;
  private questionStartedAt = 0;
  private timerSub?: Subscription;

  // ── Cronómetro por ronda ──────────────────────────────────────────────────
  roundElapsedSec        = 0;
  roundFinalSec          = 0;
  private roundStartedAt = 0;
  private roundTimerSub?: Subscription;

  // ── Cronómetro global de sesión ───────────────────────────────────────────
  sessionElapsedSec        = 0;
  private sessionStartedAt = 0;
  private sessionTimerSub?: Subscription;

  // ── Estado por pregunta ───────────────────────────────────────────────────
  selectedIds: string[] = [];
  isCorrect: boolean | null = null;

  constructor(private quiz: QuizService, private cdr: ChangeDetectorRef) {}

  // ── Ciclo de vida ─────────────────────────────────────────────────────────

  ngOnInit(): void {
    // Solo muestra la pantalla de selección; no carga nada automáticamente.
    this.state = 'select';
  }

  ngOnDestroy(): void {
    this.stopTimer();
    this.stopRoundTimer();
    this.stopSessionTimer();
  }

  // ── Selección de banco ────────────────────────────────────────────────────

  /**
   * Llamado desde el template al hacer clic en uno de los botones de banco.
   * @param filename  'questions.json' | 'questions_2.json'
   */
  selectBank(filename: string): void {
    this.selectedFile = filename;
    this._loadBank(filename);
  }

  /** Vuelve a la pantalla de selección y limpia todo el estado. */
  goToSelect(): void {
    this.stopTimer();
    this.stopRoundTimer();
    this.stopSessionTimer();
    this._resetState();
    this.state = 'select';
  }

  /** Carga el banco indicado mediante el QuizService. */
  private _loadBank(filename: string): void {
    this.state = 'loading';

    this.quiz
      .loadNormalizedCached(
        { timePerQuestionSec: 60, shuffleQuestions: true, shuffleOptions: true },
        { useLocalStorage: true, filename }   // ← se pasa el filename al servicio
      )
      .subscribe({
        next: ({ settings, questions, meta, roundConfig }) => {
          this.settings       = settings;
          this.meta           = meta;
          this.roundConfig    = roundConfig;
          this.pool           = [...questions];
          this.totalQuestions = this.pool.length;

          if (!this.totalQuestions) {
            this.state    = 'error';
            this.errorMsg = `No hay preguntas en public/${filename}`;
            return;
          }
          this.startNewRound();
        },
        error: (err) => {
          console.error(err);
          this.state    = 'error';
          this.errorMsg = `No se pudo cargar ${filename}.`;
        },
      });
  }

  // ── Getters de template ───────────────────────────────────────────────────

  get q(): QuizQuestion {
    return this.roundQuestions[this.roundIndex];
  }

  get isMultiple(): boolean {
    return this.q?.type === 'multiple';
  }

  get inRoundNumber(): number {
    return this.roundIndex + 1;
  }

  get roundNumber(): number {
    return Math.floor(this.answeredQuestions / this.roundSize) + 1;
  }

  get globalProgressPct(): number {
    return this.totalQuestions
      ? Math.round((this.answeredQuestions / this.totalQuestions) * 100)
      : 0;
  }

  get score(): number {
    return this.correctTotal;
  }

  get scorePct(): number {
    return this.answeredQuestions
      ? Math.round((this.correctTotal / this.answeredQuestions) * 100)
      : 0;
  }

  get roundScore(): number {
    return this.roundAnswers.filter((a) => a.isCorrect).length;
  }

  get motivationalMessage(): string {
    const score = this.roundScore;
    if (score <= 12) return '💪 Sigue practicando, ¡tú puedes!';
    if (score <= 24) return '📖 Lo estás haciendo bien, sigue estudiando, ¡tú puedes!';
    if (score <= 30) return '🚀 ¡Vas muy bien Tavito!';
    return                  '🌟 ¡Excelente, bravo, eres muy inteligente!';
  }

  get motivationalClass(): string {
    const score = this.roundScore;
    if (score <= 12) return 'msg--low';
    if (score <= 24) return 'msg--mid';
    if (score <= 30) return 'msg--good';
    return                  'msg--great';
  }

  formatTime(totalSec: number): string {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  }

  get roundTimeFormatted(): string {
    return this.formatTime(this.roundFinalSec);
  }

  get sessionTimeFormatted(): string {
    return this.formatTime(this.sessionElapsedSec);
  }

  // ── Cronómetros ───────────────────────────────────────────────────────────

  private startTimer(): void {
    this.stopTimer();
    this.updateTimeLeft();
    this.timerSub = interval(250).subscribe(() => this.updateTimeLeft());
  }

  private stopTimer(): void {
    this.timerSub?.unsubscribe();
    this.timerSub = undefined;
  }

  private updateTimeLeft(): void {
    if (this.state !== 'playing') return;
    const elapsed = Math.floor((Date.now() - this.questionStartedAt) / 1000);
    this.timeLeft = Math.max(0, this.settings.timePerQuestionSec - elapsed);
    this.cdr.detectChanges();
    if (this.timeLeft === 0) this.confirmAnswer();
  }

  private startRoundTimer(): void {
    this.stopRoundTimer();
    this.roundStartedAt  = Date.now();
    this.roundElapsedSec = 0;
    this.roundTimerSub   = interval(1000).subscribe(() => {
      this.roundElapsedSec = Math.floor((Date.now() - this.roundStartedAt) / 1000);
      this.cdr.detectChanges();
    });
  }

  private stopRoundTimer(): void {
    this.roundTimerSub?.unsubscribe();
    this.roundTimerSub = undefined;
    this.roundFinalSec = Math.floor((Date.now() - this.roundStartedAt) / 1000);
  }

  private startSessionTimer(): void {
    if (this.sessionTimerSub) return;
    this.sessionStartedAt = Date.now();
    this.sessionTimerSub  = interval(1000).subscribe(() => {
      this.sessionElapsedSec = Math.floor((Date.now() - this.sessionStartedAt) / 1000);
      this.cdr.detectChanges();
    });
  }

  private stopSessionTimer(): void {
    this.sessionTimerSub?.unsubscribe();
    this.sessionTimerSub   = undefined;
    this.sessionElapsedSec = Math.floor((Date.now() - this.sessionStartedAt) / 1000);
  }

  // ── Lógica de rondas ──────────────────────────────────────────────────────

  private startNewRound(): void {
    this.stopTimer();
    this.stopRoundTimer();

    if (!this.pool.length) {
      this.stopSessionTimer();
      this.state = 'finished';
      return;
    }

    this.roundQuestions  = this.pool.splice(0, this.roundSize);
    this.roundIndex      = 0;
    this.roundAnswers    = [];
    this.roundElapsedSec = 0;
    this.roundFinalSec   = 0;
    this.state           = 'playing';

    this.startRoundTimer();
    this.startSessionTimer();
    this.startQuestion();
  }

  private startQuestion(): void {
    this.selectedIds       = [];
    this.isCorrect         = null;
    this.timeLeft          = this.settings.timePerQuestionSec;
    this.questionStartedAt = Date.now();
    this.state             = 'playing';
    this.startTimer();
  }

  // ── Selección de opciones ─────────────────────────────────────────────────

  toggleOption(optionId: string): void {
    if (this.state !== 'playing') return;

    if (!this.isMultiple) {
      this.selectedIds = [optionId];
      this.confirmAnswer();
    } else {
      const idx = this.selectedIds.indexOf(optionId);
      if (idx === -1) {
        this.selectedIds = [...this.selectedIds, optionId];
      } else {
        this.selectedIds = this.selectedIds.filter((id) => id !== optionId);
      }
    }
  }

  isSelected(optionId: string): boolean {
    return this.selectedIds.includes(optionId);
  }

  confirmAnswer(): void {
    if (this.state !== 'playing') return;
    this.stopTimer();
    this.state = 'answered';

    const correctIds = this.q.correctOptionIds ?? [];

    const ok = this.isMultiple
      ? correctIds.length === this.selectedIds.length &&
        correctIds.every((id) => this.selectedIds.includes(id))
      : this.selectedIds.length > 0 &&
        correctIds.includes(this.selectedIds[0]);

    this.isCorrect = ok;
    if (ok) this.correctTotal++; else this.wrongTotal++;
    this.answeredQuestions++;

    this.roundAnswers.push({
      q: this.q,
      selectedIds: [...this.selectedIds],
      correctIds,
      isCorrect: ok,
      timeSpentSec: this.settings.timePerQuestionSec - this.timeLeft,
    });
  }

  // ── CSS class por opción ──────────────────────────────────────────────────

  optionClass(optionId: string): string {
    if (this.state === 'playing') {
      return this.isSelected(optionId) ? 'selected' : '';
    }

    const isRight    = this.q.correctOptionIds.includes(optionId);
    const isSelected = this.selectedIds.includes(optionId);

    if (isRight)                return 'correct';
    if (isSelected && !isRight) return 'wrong';
    return 'dim';
  }

  // ── Navegación ────────────────────────────────────────────────────────────

  nextQuestionOrSummary(): void {
    if (this.roundIndex < this.roundQuestions.length - 1) {
      this.roundIndex++;
      this.startQuestion();
      return;
    }
    this.stopRoundTimer();
    this.state = 'roundSummary';
  }

  continueNextRound(): void {
    this.startNewRound();
  }

  restartAll(): void {
    this.stopTimer();
    this.stopRoundTimer();
    this.stopSessionTimer();
    this._resetState();

    // Recarga el mismo banco que estaba activo
    if (this.selectedFile) {
      this._loadBank(this.selectedFile);
    } else {
      this.state = 'select';
    }
  }

  // ── Helpers internos ──────────────────────────────────────────────────────

  /** Limpia todo el estado de partida sin tocar `selectedFile`. */
  private _resetState(): void {
    this.correctTotal      = 0;
    this.wrongTotal        = 0;
    this.answeredQuestions = 0;
    this.roundIndex        = 0;
    this.roundElapsedSec   = 0;
    this.roundFinalSec     = 0;
    this.sessionElapsedSec = 0;
    this.sessionStartedAt  = 0;
    this.roundStartedAt    = 0;
    this.roundQuestions    = [];
    this.roundAnswers      = [];
    this.selectedIds       = [];
    this.isCorrect         = null;
    this.timeLeft          = 0;
    this.pool              = [];
    this.totalQuestions    = 0;
  }

  // ── Helpers de template ───────────────────────────────────────────────────

  labelForOptions(q: QuizQuestion, selectedIds: string[]): string {
    if (!selectedIds.length) return 'Sin respuesta';
    return selectedIds
      .map((id) => {
        const opt = q.options.find((o) => o.id === id);
        return opt ? `${opt.id}: ${opt.text}` : id;
      })
      .join(', ');
  }

  correctLabels(q: QuizQuestion): string {
    return (q.correctOptionIds ?? [])
      .map((id) => {
        const opt = q.options.find((o) => o.id === id);
        return opt ? `${opt.id}: ${opt.text}` : id;
      })
      .join(' | ');
  }
}