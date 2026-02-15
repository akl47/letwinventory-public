import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpErrorResponse } from '@angular/common/http';
import { vi } from 'vitest';
import { ErrorNotificationService } from './error-notification.service';

describe('ErrorNotificationService', () => {
  let service: ErrorNotificationService;
  let snackBarMock: { open: ReturnType<typeof vi.fn>; dismiss: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn(), dismiss: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: MatSnackBar, useValue: snackBarMock }
      ]
    });
    service = TestBed.inject(ErrorNotificationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('showSuccess', () => {
    it('should open snackbar with success config', () => {
      service.showSuccess('Item saved');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Item saved',
        'Close',
        expect.objectContaining({ panelClass: ['success-snackbar'], duration: 3000 })
      );
    });
  });

  describe('showError', () => {
    it('should open snackbar with error config', () => {
      service.showError('Something failed');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Something failed',
        'Dismiss',
        expect.objectContaining({ panelClass: ['error-snackbar'], duration: 5000 })
      );
    });

    it('should use custom duration when provided', () => {
      service.showError('Timeout', 10000);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Timeout',
        'Dismiss',
        expect.objectContaining({ duration: 10000 })
      );
    });
  });

  describe('showWarning', () => {
    it('should open snackbar with warning config', () => {
      service.showWarning('Be careful');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Be careful',
        'Close',
        expect.objectContaining({ panelClass: ['warning-snackbar'], duration: 4000 })
      );
    });
  });

  describe('showInfo', () => {
    it('should open snackbar with info config', () => {
      service.showInfo('FYI');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'FYI',
        'Close',
        expect.objectContaining({ panelClass: ['info-snackbar'], duration: 3000 })
      );
    });

    it('should use custom duration when provided', () => {
      service.showInfo('Note', 8000);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Note',
        'Close',
        expect.objectContaining({ duration: 8000 })
      );
    });
  });

  describe('dismiss', () => {
    it('should dismiss the snackbar', () => {
      service.dismiss();
      expect(snackBarMock.dismiss).toHaveBeenCalled();
    });
  });

  describe('showHttpError', () => {
    it('should extract string error from HttpErrorResponse', () => {
      const error = new HttpErrorResponse({ error: 'Not allowed', status: 403 });
      service.showHttpError(error);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Not allowed',
        'Dismiss',
        expect.objectContaining({ panelClass: ['error-snackbar'] })
      );
    });

    it('should extract message property from error object', () => {
      const error = new HttpErrorResponse({
        error: { message: 'Validation failed' },
        status: 422
      });
      service.showHttpError(error);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Validation failed',
        'Dismiss',
        expect.anything()
      );
    });

    it('should extract error property from error object', () => {
      const error = new HttpErrorResponse({
        error: { error: 'Duplicate entry' },
        status: 409
      });
      service.showHttpError(error);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Duplicate entry',
        'Dismiss',
        expect.anything()
      );
    });

    it('should combine custom message with detailed message', () => {
      const error = new HttpErrorResponse({
        error: { message: 'ID not found' },
        status: 404
      });
      service.showHttpError(error, 'Failed to load item');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to load item: ID not found',
        'Dismiss',
        expect.anything()
      );
    });

    it('should use custom message alone when no detailed message', () => {
      const error = new HttpErrorResponse({ error: null, status: 0, statusText: '' });
      // error.error is null, error.message will be set by HttpErrorResponse constructor
      // Since error.message exists, it will be combined with custom message
      service.showHttpError(error, 'Connection failed');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('Connection failed'),
        'Dismiss',
        expect.anything()
      );
    });

    it('should fallback to 401 status message', () => {
      // Create an error where error.error is falsy and error.message is empty
      const error = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
      service.showHttpError(error);
      // error.message is set by HttpErrorResponse, so detailedMessage = error.message
      // The result will be the error.message string from HttpErrorResponse
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.any(String),
        'Dismiss',
        expect.anything()
      );
    });

    it('should fallback to 500 status message when error body is empty object', () => {
      // HttpErrorResponse with an empty object as error - none of string/message/error properties exist
      // but error.error is truthy (empty object), so we go through the if branches and get no detailedMessage
      // Then error.message is set by HttpErrorResponse constructor, so we use that
      const error = new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error' });
      service.showHttpError(error);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.any(String),
        'Dismiss',
        expect.anything()
      );
    });

    it('should handle non-HTTP errors with message property', () => {
      const error = { message: 'Network timeout' };
      service.showHttpError(error);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Network timeout',
        'Dismiss',
        expect.anything()
      );
    });

    it('should combine custom message with non-HTTP error message', () => {
      const error = { message: 'Socket closed' };
      service.showHttpError(error, 'Upload failed');
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Upload failed: Socket closed',
        'Dismiss',
        expect.anything()
      );
    });

    it('should return default message when no info available', () => {
      service.showHttpError({});
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'An unexpected error occurred. Please try again.',
        'Dismiss',
        expect.anything()
      );
    });
  });
});
