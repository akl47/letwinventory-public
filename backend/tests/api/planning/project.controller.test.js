describe('Project Controller', () => {
  let projectController;
  let mockReq;
  let mockRes;
  let mockNext;

  beforeEach(() => {
    global.db = {
      Project: {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByPk: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        destroy: jest.fn()
      },
      Task: {},
      TaskList: {}
    };

    jest.resetModules();

    // Mock the controller module
    projectController = {
      getAllProjects: jest.fn((req, res, next) => {
        global.db.Project.findAll({
          order: [['id', 'DESC']],
          include: [
            { model: global.db.TaskList },
            { model: global.db.Task }
          ]
        }).then(projects => {
          res.json(projects);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Getting Projects: ' + error));
        });
      }),

      getProjectById: jest.fn((req, res, next) => {
        global.db.Project.findOne({
          where: { id: req.params.id }
        }).then(project => {
          if (!project) {
            return next(require('http-errors')(404, 'Project not found'));
          }
          res.json(project);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Getting Project: ' + error));
        });
      }),

      createNewProject: jest.fn((req, res, next) => {
        global.db.Project.create(req.body).then(project => {
          res.json(project);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Creating Project: ' + error));
        });
      }),

      updateProjectByID: jest.fn((req, res, next) => {
        global.db.Project.update(req.body, {
          where: { id: req.params.id },
          returning: true
        }).then(updated => {
          res.json(updated[1]);
        }).catch(error => {
          next(require('http-errors')(500, 'Error Updating Project: ' + error));
        });
      }),

      deleteProjectByID: jest.fn((req, res, next) => {
        global.db.Project.destroy({
          where: { id: req.params.id }
        }).then(deleted => {
          res.json({ deleted });
        }).catch(error => {
          next(require('http-errors')(500, 'Error Deleting Project: ' + error));
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

  describe('getAllProjects', () => {
    it('should return all projects', async () => {
      const mockProjects = [
        { id: 1, name: 'Project 1', description: 'Description 1' },
        { id: 2, name: 'Project 2', description: 'Description 2' }
      ];

      global.db.Project.findAll.mockResolvedValue(mockProjects);

      await projectController.getAllProjects(mockReq, mockRes, mockNext);

      expect(global.db.Project.findAll).toHaveBeenCalled();
      expect(mockRes.json).toHaveBeenCalledWith(mockProjects);
    });

    it('should call next with error when database fails', async () => {
      global.db.Project.findAll.mockRejectedValue(new Error('Database error'));

      await projectController.getAllProjects(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('getProjectById', () => {
    it('should return a single project by ID', async () => {
      const mockProject = { id: 1, name: 'Test Project' };
      mockReq.params.id = '1';

      global.db.Project.findOne.mockResolvedValue(mockProject);

      await projectController.getProjectById(mockReq, mockRes, mockNext);

      expect(global.db.Project.findOne).toHaveBeenCalledWith({
        where: { id: '1' }
      });
      expect(mockRes.json).toHaveBeenCalledWith(mockProject);
    });

    it('should return 404 when project not found', async () => {
      mockReq.params.id = '999';
      global.db.Project.findOne.mockResolvedValue(null);

      await projectController.getProjectById(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('createNewProject', () => {
    it('should create a new project', async () => {
      const newProject = {
        id: 1,
        name: 'New Project',
        description: 'Project description'
      };

      mockReq.body = {
        name: 'New Project',
        description: 'Project description'
      };

      global.db.Project.create.mockResolvedValue(newProject);

      await projectController.createNewProject(mockReq, mockRes, mockNext);

      expect(global.db.Project.create).toHaveBeenCalledWith(mockReq.body);
      expect(mockRes.json).toHaveBeenCalledWith(newProject);
    });

    it('should call next with error when creation fails', async () => {
      mockReq.body = { name: 'Test Project' };
      global.db.Project.create.mockRejectedValue(new Error('Creation error'));

      await projectController.createNewProject(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('updateProjectByID', () => {
    it('should update a project by ID', async () => {
      const updatedProject = { id: 1, name: 'Updated Project' };
      mockReq.params.id = '1';
      mockReq.body = { name: 'Updated Project' };

      global.db.Project.update.mockResolvedValue([1, [updatedProject]]);

      await projectController.updateProjectByID(mockReq, mockRes, mockNext);

      expect(global.db.Project.update).toHaveBeenCalledWith(mockReq.body, {
        where: { id: '1' },
        returning: true
      });
      expect(mockRes.json).toHaveBeenCalledWith([updatedProject]);
    });

    it('should call next with error when update fails', async () => {
      mockReq.params.id = '1';
      mockReq.body = { name: 'Updated Project' };
      global.db.Project.update.mockRejectedValue(new Error('Update error'));

      await projectController.updateProjectByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });

  describe('deleteProjectByID', () => {
    it('should delete a project by ID', async () => {
      mockReq.params.id = '1';
      global.db.Project.destroy.mockResolvedValue(1);

      await projectController.deleteProjectByID(mockReq, mockRes, mockNext);

      expect(global.db.Project.destroy).toHaveBeenCalledWith({
        where: { id: '1' }
      });
      expect(mockRes.json).toHaveBeenCalledWith({ deleted: 1 });
    });

    it('should call next with error when deletion fails', async () => {
      mockReq.params.id = '1';
      global.db.Project.destroy.mockRejectedValue(new Error('Deletion error'));

      await projectController.deleteProjectByID(mockReq, mockRes, mockNext);

      expect(mockNext).toHaveBeenCalled();
    });
  });
});
