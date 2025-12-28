import { Injectable, inject } from '@angular/core';
import { MatSnackBar, MatSnackBarConfig } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';

@Injectable({
  providedIn: 'root'
})
export class ErrorNotificationService {
  private snackBar = inject(MatSnackBar);

  private defaultConfig: MatSnackBarConfig = {
    duration: 5000,
    horizontalPosition: 'center',
    verticalPosition: 'bottom',
    panelClass: ['error-snackbar']
  };

  private successConfig: MatSnackBarConfig = {
    duration: 3000,
    horizontalPosition: 'center',
    verticalPosition: 'bottom',
    panelClass: ['success-snackbar']
  };

  private warningConfig: MatSnackBarConfig = {
    duration: 4000,
    horizontalPosition: 'center',
    verticalPosition: 'bottom',
    panelClass: ['warning-snackbar']
  };

  /**
   * Display an HTTP error in a snackbar
   */
  showHttpError(error: HttpErrorResponse | any, customMessage?: string) {
    const message = this.extractErrorMessage(error, customMessage);
    this.snackBar.open(message, 'Dismiss', this.defaultConfig);
  }

  /**
   * Display a success message
   */
  showSuccess(message: string) {
    this.snackBar.open(message, 'Close', this.successConfig);
  }

  /**
   * Display a warning message
   */
  showWarning(message: string) {
    this.snackBar.open(message, 'Close', this.warningConfig);
  }

  /**
   * Display a generic error message
   */
  showError(message: string, duration?: number) {
    const config = { ...this.defaultConfig };
    if (duration) {
      config.duration = duration;
    }
    this.snackBar.open(message, 'Dismiss', config);
  }

  /**
   * Display an info message
   */
  showInfo(message: string, duration?: number) {
    const config: MatSnackBarConfig = {
      duration: duration || 3000,
      horizontalPosition: 'center',
      verticalPosition: 'bottom',
      panelClass: ['info-snackbar']
    };
    this.snackBar.open(message, 'Close', config);
  }

  /**
   * Extract error message from HttpErrorResponse
   */
  private extractErrorMessage(error: any, customMessage?: string): string {
    let detailedMessage = '';

    if (error instanceof HttpErrorResponse) {
      // Extract the detailed server error message
      if (error.error) {
        if (typeof error.error === 'string') {
          detailedMessage = error.error;
        } else if (error.error.message) {
          detailedMessage = error.error.message;
        } else if (error.error.error) {
          detailedMessage = error.error.error;
        }
      }

      // If no detailed message from error.error, try error.message
      if (!detailedMessage && error.message) {
        detailedMessage = error.message;
      }

      // If we have both custom message and detailed message, combine them
      if (customMessage && detailedMessage) {
        return `${customMessage}: ${detailedMessage}`;
      }

      // If only custom message, return it
      if (customMessage) {
        return customMessage;
      }

      // If only detailed message, return it
      if (detailedMessage) {
        return detailedMessage;
      }

      // HTTP status error messages as fallback
      switch (error.status) {
        case 0:
          return 'Unable to connect to server. Please check your internet connection.';
        case 400:
          return error.error?.message || 'Bad request. Please check your input.';
        case 401:
          return 'Unauthorized. Please log in again.';
        case 403:
          return 'Access forbidden. You do not have permission to perform this action.';
        case 404:
          return error.error?.message || 'Resource not found.';
        case 409:
          return error.error?.message || 'Conflict. The resource already exists or is in use.';
        case 422:
          return error.error?.message || 'Validation error. Please check your input.';
        case 500:
          return 'Internal server error. Please try again later.';
        case 503:
          return 'Service temporarily unavailable. Please try again later.';
        default:
          return error.statusText || `An error occurred (${error.status})`;
      }
    }

    // Client-side or network error
    if (error.message) {
      if (customMessage) {
        return `${customMessage}: ${error.message}`;
      }
      return error.message;
    }

    return customMessage || 'An unexpected error occurred. Please try again.';
  }

  /**
   * Dismiss any open snackbars
   */
  dismiss() {
    this.snackBar.dismiss();
  }
}
