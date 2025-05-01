import { Component, OnInit, OnDestroy } from '@angular/core';

@Component({
    selector: 'app-pomodoro-bar',
    templateUrl: './pomodoro-bar.component.html',
    styleUrls: ['./pomodoro-bar.component.scss'],

})
export class PomodoroBarComponent implements OnInit, OnDestroy {
    private timer: any;
    private readonly POMODORO_DURATION = 25 * 60; // 25 minutes in seconds
    private readonly SHORT_BREAK_DURATION = 5 * 60; // 5 minutes in seconds
    private readonly LONG_BREAK_DURATION = 15 * 60; // 15 minutes in seconds

    timeLeft: number = this.POMODORO_DURATION;
    isRunning: boolean = false;
    mode: 'pomodoro' | 'shortBreak' | 'longBreak' = 'pomodoro';
    progress: number = 100;

    ngOnInit(): void {
        this.updateDisplay();
    }

    ngOnDestroy(): void {
        this.stopTimer();
    }

    startTimer(): void {
        if (!this.isRunning) {
            this.isRunning = true;
            this.timer = setInterval(() => {
                this.timeLeft--;
                this.updateDisplay();
                if (this.timeLeft <= 0) {
                    this.stopTimer();
                    // TODO: Add notification sound
                }
            }, 1000);
        }
    }

    stopTimer(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.isRunning = false;
        }
    }

    resetTimer(): void {
        this.stopTimer();
        this.timeLeft = this.getDurationForMode();
        this.updateDisplay();
    }

    toggleTimer(): void {
        if (this.isRunning) {
            this.stopTimer();
        } else {
            this.startTimer();
        }
    }

    switchMode(mode: 'pomodoro' | 'shortBreak' | 'longBreak'): void {
        this.mode = mode;
        this.timeLeft = this.getDurationForMode();
        this.updateDisplay();
    }

    private getDurationForMode(): number {
        switch (this.mode) {
            case 'pomodoro':
                return this.POMODORO_DURATION;
            case 'shortBreak':
                return this.SHORT_BREAK_DURATION;
            case 'longBreak':
                return this.LONG_BREAK_DURATION;
        }
    }

    private updateDisplay(): void {
        this.progress = (this.timeLeft / this.getDurationForMode()) * 100;
    }

    get formattedTime(): string {
        const minutes = Math.floor(this.timeLeft / 60);
        const seconds = this.timeLeft % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
} 