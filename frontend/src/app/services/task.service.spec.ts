import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { TaskService } from './task.service';

const API_URL = 'https://dev.letwin.co/api';

describe('TaskService', () => {
    let service: TaskService;
    let httpMock: HttpTestingController;

    beforeEach(() => {
        TestBed.configureTestingModule({
            providers: [provideHttpClient(), provideHttpClientTesting()]
        });
        service = TestBed.inject(TaskService);
        httpMock = TestBed.inject(HttpTestingController);
    });

    afterEach(() => {
        httpMock.verify();
    });

    it('triggerRefresh should emit on refreshTaskLists$', () => {
        let emitted = false;
        service.refreshTaskLists$.subscribe(() => emitted = true);

        service.triggerRefresh();

        expect(emitted).toBe(true);
    });

    it('getTaskLists should GET /planning/tasklist', () => {
        const mockLists = [{ id: 1, name: 'Backlog' }];

        service.getTaskLists().subscribe(result => {
            expect(result).toEqual(mockLists);
        });

        const req = httpMock.expectOne(`${API_URL}/planning/tasklist`);
        expect(req.request.method).toBe('GET');
        req.flush(mockLists);
    });

    it('createTask should POST to /planning/task', () => {
        const newTask = { name: 'New task', taskListId: 1 };
        const mockResponse = { id: 1, ...newTask };

        service.createTask(newTask).subscribe(result => {
            expect(result).toEqual(mockResponse);
        });

        const req = httpMock.expectOne(`${API_URL}/planning/task`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual(newTask);
        req.flush(mockResponse);
    });

    it('moveTask should PUT to /planning/task/:id/move', () => {
        service.moveTask(5, 2, 3).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/task/5/move`);
        expect(req.request.method).toBe('PUT');
        expect(req.request.body).toEqual({ taskListId: 2, newIndex: 3 });
        req.flush({});
    });

    it('updateTask should PUT to /planning/task/:id', () => {
        const updates = { name: 'Updated' };

        service.updateTask(5, updates).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/task/5`);
        expect(req.request.method).toBe('PUT');
        expect(req.request.body).toEqual(updates);
        req.flush({});
    });

    it('getTask should GET /planning/task/:id', () => {
        service.getTask(7).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/task/7`);
        expect(req.request.method).toBe('GET');
        req.flush({ id: 7 });
    });

    it('getSubtasks should GET /planning/task with parentTaskID query param', () => {
        service.getSubtasks(3).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/task?parentTaskID=3`);
        expect(req.request.method).toBe('GET');
        req.flush([]);
    });

    it('getAllTasks should GET /planning/task', () => {
        service.getAllTasks().subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/task`);
        expect(req.request.method).toBe('GET');
        req.flush([]);
    });

    it('getTaskTypes should GET /planning/task/types', () => {
        service.getTaskTypes().subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/task/types`);
        expect(req.request.method).toBe('GET');
        req.flush([]);
    });

    it('createTaskList should POST to /planning/tasklist', () => {
        const newList = { name: 'New List' };

        service.createTaskList(newList).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/tasklist`);
        expect(req.request.method).toBe('POST');
        expect(req.request.body).toEqual(newList);
        req.flush({ id: 1, ...newList });
    });

    it('updateTaskList should PUT to /planning/tasklist/:id', () => {
        const updates = { name: 'Renamed' };

        service.updateTaskList(2, updates).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/tasklist/2`);
        expect(req.request.method).toBe('PUT');
        expect(req.request.body).toEqual(updates);
        req.flush({});
    });

    it('reorderTaskLists should PUT to /planning/tasklist/reorder', () => {
        const orderedIds = [3, 1, 2];

        service.reorderTaskLists(orderedIds).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/tasklist/reorder`);
        expect(req.request.method).toBe('PUT');
        expect(req.request.body).toEqual({ orderedIds });
        req.flush(null);
    });

    it('deleteTaskList should DELETE /planning/tasklist/:id', () => {
        service.deleteTaskList(4).subscribe();

        const req = httpMock.expectOne(`${API_URL}/planning/tasklist/4`);
        expect(req.request.method).toBe('DELETE');
        req.flush(null);
    });
});
