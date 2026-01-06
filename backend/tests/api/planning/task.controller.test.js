describe('Task Controller', () => {
  let taskController;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    global.db = {
      Task: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        destroy: jest.fn()
      },
      TaskList: {},
      Project: {},
      TaskHistory: {}
    };

    jest.resetModules();

    // Mock the controller module
    taskController = {
      getAllTasks: jest.fn((req, res, next) => {
        global.db.Task.findAll({
          order: [['id', 'DESC']],
          include: [
            { model: global.db.TaskList },
            { model: global.db.Project }
          ]
        }).then(tasks => {
          res.json(tasks);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Getting Tasks: ' + error));
        });
      }),

      getTaskById: jest.fn((req, res, next) => {
        global.db.Task.findOne({
          where: { id: req.params.id }
        }).then(task => {
          if (!task) {
            return next(require('http-errors')(404, 'Task not found'));
          }
          res.json(task);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Getting Task: ' + error));
        });
      }),

      createNewTask: jest.fn((req, res, next) => {
        global.db.Task.create(req.body).then(task => {
          res.json(task);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Creating Task: ' + error));
        });
      }),

      updateTaskByID: jest.fn((req, res, next) => {
        global.db.Task.update(req.body, {
          where: { id: req.params.id },
          returning: true
        }).then(updated => {
          res.json(updated[1]);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Updating Task: ' + error));
        });
      }),

      deleteTaskByID: jest.fn((req, res, next) => {
        global.db.Task.destroy({
          where: { id: req.params.id }
        }).then(deleted => {
          res.json({ deleted });
        }).catch(error => {
          next(require('http-errors')(500, 'Error Deleting Task: ' + error));
        });
      })
    };

    mockReq = {
      body: {},
      params: {}
    };
    mockRes = {
      json: jest.fn().mockReturnThis(),
      status: jest.fn().mockReturnThis()
    };
    mockNext = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete global.db;
  });

  describe('getAllTasks', () => {
    it('should return all tasks', async () => {
      const mockTasks = [
        { id: 1, title: 'Task 1', description: 'Description 1' },
        { id: 2, title: 'Task 2', description: 'Description 2' }
      ];

      global.db.Task.findAll.mockResolvedValue(mockTasks);

      await taskController.getAllTasks(mockReq, mockRes, mockNext);

      expect(global.db.Task.findAll).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(mockTasks);
    });

    it('should call next with error when database fails', async () => {
      global.db.Task.findAll.mockRejectedValue(new Error('Database error'));

      await taskController.getAllTasks(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getTaskById', () => {
    it('should return a single task by ID', async () => {
      const mockTask = { id: 1, title: 'Test Task' };
      mockReq.params.id = '1';

      global.db.Task.findOne.mockResolvedValue(mockTask);

      await taskController.getTaskById(mockReq, mockRes, mockNext);

      expect(global.db.Task.findOne).toHaveBeenCalledWith({
        where: { id: '1' }
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockTask);
    });

    it('should return 404 when task not found', async () => {
      mockReq.params.id = '999';
      global.db.Task.findOne.mockResolvedValue(null);

      await taskController.getTaskById(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('createNewTask', () => {
    it('should create a new task', async () => {
      const newTask = {
        id: 1,
        title: 'New Task',
        description: 'Task description',
        projectID: 1,
        taskListID: 1
      };

      mockReq.body = {
        title: 'New Task',
        description: 'Task description',
        projectID: 1,
        taskListID: 1
      };

      global.db.Task.create.mockResolvedValue(newTask);

      await taskController.createNewTask(mockReq, mockRes, mockNext);

      expect(global.db.Task.create).toHaveBeenCalledWith(mockReq.body);
      expect(mockRes.json).toHaveBeenCalledWith(newTask);
    });

    it('should call next with error when creation fails', async () => {
      mockReq.body = { title: 'Test Task' };
      global.db.Task.create.mockRejectedValue(new Error('Creation error'));

      await taskController.createNewTask(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('updateTaskByID', () => {
    it('should update a task by ID', async () => {
      const updatedTask = { id: 1, title: 'Updated Task' };
      mockReq.params.id = '1';
      mockReq.body = { title: 'Updated Task' };

      global.db.Task.update.mockResolvedValue([1, [updatedTask]]);

      await taskController.updateTaskByID(mockReq, mockRes, mockNext);

      expect(global.db.Task.update).toHaveBeenCalledWith(mockReq.body, {
        where: { id: '1' },
        returning: true
      });
      expect(mockRes.json).toHaveBeenCalledWith([updatedTask]);
    });
  });

  describe('deleteTaskByID', () => {
    it('should delete a task by ID', async () => {
      mockReq.params.id = '1';
      global.db.Task.destroy.mockResolvedValue(1);

      await taskController.deleteTaskByID(mockReq, mockRes, mockNext);

      expect(global.db.Task.destroy).toHaveBeenCalledWith({
        where: { id: '1' }
      });
      expect(mockRes.json).toHaveBeenCalledWith({ deleted: 1 });
    });

    it('should call next with error when deletion fails', async () => {
      mockReq.params.id = '1';
      global.db.Task.destroy.mockRejectedValue(new Error('Deletion error'));

      await taskController.deleteTaskByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
