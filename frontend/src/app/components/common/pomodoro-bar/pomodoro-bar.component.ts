import { Component, OnInit, OnDestroy } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PomodoroBarService } from '../../../services/pomodoro-bar.service';
import { Subscription } from 'rxjs';
import { AuthService } from '../../../services/common/auth.service';

@Component({
    selector: 'app-pomodoro-bar',
    templateUrl: './pomodoro-bar.component.html',
    styleUrls: ['./pomodoro-bar.component.scss'],
    standalone: false
})
export class PomodoroBarComponent implements OnInit, OnDestroy {
    private timer: any;
    private timeUpdateInterval: any;
    private readonly POMODORO_DURATION = 25 * 60; // 25 minutes in seconds
    private readonly SHORT_BREAK_DURATION = 5 * 60; // 5 minutes in seconds
    private pomo_start_ding: HTMLAudioElement;
    private pomo_end_ding: HTMLAudioElement;
    private subscription: Subscription;
    private authSubscription: Subscription;

    timeLeft: number = this.POMODORO_DURATION;
    isRunning: boolean = false;
    mode: 'pomodoro' | 'shortBreak' | 'longBreak' = 'pomodoro';
    progress: number = 100;
    currentTimeMod30: string = '';
    isMuted = false;
    notificationsEnabled = true;
    isCompact = false;
    isAuthenticated = false;
    isVisible = true;

    constructor(
        private snackBar: MatSnackBar, 
        private pomodoroBarService: PomodoroBarService,
        private auth: AuthService
    ) {
        this.pomo_start_ding = new Audio('assets/sounds/pomo_start.mp3');
        this.pomo_end_ding = new Audio('assets/sounds/pomo_end.mp3');
        this.subscription = this.pomodoroBarService.isCompact$.subscribe(isCompact => {
            this.isCompact = isCompact;
        });
        this.authSubscription = this.auth.isAuthenticated$.subscribe(
            isAuth => this.isAuthenticated = isAuth
        );
    }

    ngOnInit(): void {
        this.updateDisplay();
        this.updateCurrentTime();
        this.timeUpdateInterval = setInterval(() => this.updateCurrentTime(), 1000);
        this.requestNotificationPermission();
    }

    ngOnDestroy(): void {
        if (this.timeUpdateInterval) {
            clearInterval(this.timeUpdateInterval);
        }
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
        if (this.authSubscription) {
            this.authSubscription.unsubscribe();
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
                return this.SHORT_BREAK_DURATION;
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

        // Check current mode
        if(minutes*60+seconds > this.POMODORO_DURATION) {
            this.switchMode("shortBreak")
        } else {
            this.switchMode("pomodoro")
        }
        // Get the time left for the current mode
        if(this.mode === "pomodoro") {
            this.timeLeft = this.POMODORO_DURATION - (minutes*60+seconds)
        } else {
            this.timeLeft = (this.POMODORO_DURATION+this.SHORT_BREAK_DURATION) - (minutes*60+seconds)
        }
        //Calculate the progress
        this.progress = 100-(this.timeLeft/this.getDurationForMode())*100

        // Check if timer completed
        if (this.timeLeft === 1 ) {
            this.handleTimerComplete();
        }
       
        let remainingMinutes = Math.floor(this.timeLeft/60)
        let remainingSeconds = this.timeLeft%60

        this.currentTimeMod30 = `${remainingMinutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}/${Math.floor(this.getDurationForMode()/60).toString().padStart(2, '0')}:${(this.getDurationForMode()%60).toString().padStart(2, '0')}`;
    }

    private async requestNotificationPermission() {
        if ('Notification' in window) {
            const permission = await Notification.requestPermission();
            this.notificationsEnabled = permission === 'granted';
        }
    }

    private handleTimerComplete(): void {
        if (this.notificationsEnabled && 'Notification' in window) {
            const title = this.mode === 'pomodoro' ? 'Break Time!' : 'Time to Focus!';
            const options = {
                body: this.mode === 'pomodoro' ? 'Take a short break.' : 'Start your next pomodoro session.',
                silent: true,
            };
            new Notification(title, options);
        }

        if (!this.isMuted) {
            if(this.mode === "pomodoro") {
                this.pomo_end_ding.play().catch(error => {
                    console.error('Error playing sound:', error);
                });
            } else {
                this.pomo_start_ding.play().catch(error => {
                    console.error('Error playing sound:', error);
                });
            }
        }
    }

    toggleMute() {
        this.isMuted = !this.isMuted;
        if (this.isMuted) {
            this.pomo_start_ding.pause();
            this.pomo_end_ding.pause();
            this.pomo_start_ding.currentTime = 0;
            this.pomo_end_ding.currentTime = 0;
        }
    }

    toggleNotifications() {
        if ('Notification' in window) {
            if (Notification.permission === 'granted') {
                this.notificationsEnabled = !this.notificationsEnabled;
            } else if (Notification.permission !== 'denied') {
                Notification.requestPermission().then(permission => {
                    this.notificationsEnabled = permission === 'granted';
                });
            }
        }
    }

    toggleCompact() {
        this.isCompact = !this.isCompact;
    }

    toggleVisibility() {
        this.isVisible = !this.isVisible;
    }
} 