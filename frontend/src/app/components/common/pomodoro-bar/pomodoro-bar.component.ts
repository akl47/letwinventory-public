import { Component, OnInit, OnDestroy } from '@angular/core';

@Component({
    selector: 'app-pomodoro-bar',
    templateUrl: './pomodoro-bar.component.html',
    styleUrls: ['./pomodoro-bar.component.scss'],

})
export class PomodoroBarComponent implements OnInit, OnDestroy {
    private timer: any;
    private timeUpdateInterval: any;
    private readonly POMODORO_DURATION = 25 * 60; // 25 minutes in seconds
    private readonly SHORT_BREAK_DURATION = 5 * 60; // 5 minutes in seconds

    timeLeft: number = this.POMODORO_DURATION;
    isRunning: boolean = false;
    mode: 'pomodoro' | 'shortBreak' | 'longBreak' = 'pomodoro';
    progress: number = 100;
    currentTimeMod30: string = '';

    ngOnInit(): void {
        this.updateDisplay();
        this.updateCurrentTime();
        this.timeUpdateInterval = setInterval(() => this.updateCurrentTime(), 1000);
    }

    ngOnDestroy(): void {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
    }

    switchMode(mode: 'pomodoro' | 'shortBreak'): void {
        this.mode = mode;
        this.timeLeft = this.getDurationForMode();
        this.updateDisplay();
    }

    private getDurationForMode(): number {
        switch (this.mode) {
            case 'pomodoro':
                return this.POMODORO_DURATION;
            case 'shortBreak':
                return this.POMODORO_DURATION + this.SHORT_BREAK_DURATION;
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

    private updateCurrentTime(): void {
        const now = new Date();
        const minutes = now.getMinutes()%30;
        const seconds = now.getSeconds();
        this.timeLeft = this.getDurationForMode() - (minutes*60+seconds)
        let remainingMinutes = Math.floor(this.timeLeft/60)
        let remainingSeconds = this.timeLeft%60
        console.log("Time: ",minutes, seconds)
        console.log("Time Left", this.timeLeft)
        this.progress = 100-(this.timeLeft/this.getDurationForMode())*100
        console.log("Progress", this.progress)
        if(this.timeLeft<0) {
            this.switchMode("shortBreak")  
        } 
        this.currentTimeMod30 = `${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}/${Math.floor(this.getDurationForMode()/60).toString().padStart(2, '0')}:${(this.getDurationForMode()%60).toString().padStart(2, '0')}`;
    }
} 