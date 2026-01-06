import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TaskService } from './task.service';

describe('TaskService', () => {
  let service: TaskService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        TaskService,
        provideHttpClient(),
        provideHttpClientTesting()
      ]
    });

    service = TestBed.inject(TaskService);
    httpMock = TestBed.inject(HttpTestingController);
    localStorage.setItem('auth_token', 'test-token');
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('triggerRefresh', () => {
    it('should emit refresh event', (done) => {
      service.refreshTaskLists$.subscribe(() => {
        done();
      });
      service.triggerRefresh();
    });
  });

  describe('getTaskLists', () => {
    it('should fetch all task lists', (done) => {
      const mockTaskLists = [
        { id: 1, name: 'To Do', tasks: [] },
        { id: 2, name: 'In Progress', tasks: [] }
      ];

      service.getTaskLists().subscribe(taskLists => {
        expect(taskLists).toEqual(mockTaskLists);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/tasklist');
      expect(req.request.method).toBe('GET');
      expect(req.request.headers.get('Authorization')).toBe('Bearer test-token');
      req.flush(mockTaskLists);
    });
  });

  describe('createTask', () => {
    it('should create a new task', (done) => {
      const newTask = {
        title: 'New Task',
        description: 'Task description',
        taskListID: 1
      };

      service.createTask(newTask).subscribe(task => {
        expect(task.id).toBe(1);
        expect(task.title).toBe('New Task');
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/task');
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(newTask);
      req.flush({ id: 1, ...newTask });
    });
  });

  describe('moveTask', () => {
    it('should move a task to a new position', (done) => {
      service.moveTask(1, 2, 3).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/task/1/move');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({ taskListId: 2, newIndex: 3 });
      req.flush({ success: true });
    });
  });

  describe('updateTask', () => {
    it('should update a task', (done) => {
      const updates = { title: 'Updated Task', description: 'Updated description' };

      service.updateTask(1, updates).subscribe(result => {
        expect(result).toBeTruthy();
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/task/1');
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual(updates);
      req.flush({ id: 1, ...updates });
    });
  });

  describe('getTask', () => {
    it('should get a single task by ID', (done) => {
      const mockTask = { id: 1, title: 'Test Task', description: 'Description' };

      service.getTask(1).subscribe(task => {
        expect(task).toEqual(mockTask);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/task/1');
      expect(req.request.method).toBe('GET');
      req.flush(mockTask);
    });
  });

  describe('getSubtasks', () => {
    it('should get subtasks for a parent task', (done) => {
      const mockSubtasks = [
        { id: 2, title: 'Subtask 1', parentTaskID: 1 },
        { id: 3, title: 'Subtask 2', parentTaskID: 1 }
      ];

      service.getSubtasks(1).subscribe(subtasks => {
        expect(subtasks).toEqual(mockSubtasks);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/task?parentTaskID=1');
      expect(req.request.method).toBe('GET');
      req.flush(mockSubtasks);
    });
  });

  describe('getAllTasks', () => {
    it('should get all tasks', (done) => {
      const mockTasks = [
        { id: 1, title: 'Task 1' },
        { id: 2, title: 'Task 2' },
        { id: 3, title: 'Task 3' }
      ];

      service.getAllTasks().subscribe(tasks => {
        expect(tasks).toEqual(mockTasks);
        done();
      });

      const req = httpMock.expectOne('http://localhost:3000/api/planning/task');
      expect(req.request.method).toBe('GET');
      req.flush(mockTasks);
    });
  });
});
